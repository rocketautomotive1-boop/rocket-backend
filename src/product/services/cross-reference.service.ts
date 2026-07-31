import { Injectable, Logger, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CrossReferenceGroupModel, CrossReferenceGroupDocument } from '../schemas/cross-reference-group.schema';
import { CrossReferenceCodeModel, CrossReferenceCodeDocument } from '../schemas/cross-reference-code.schema';
import { ProductService } from '../product.service';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { normalizeCode, normalizeBrand } from '../utils/code-key.util';

@Injectable()
export class CrossReferenceService {
    private readonly logger = new Logger(CrossReferenceService.name);

    constructor(
        @InjectModel(CrossReferenceGroupModel.name)
        private readonly groupModel: Model<CrossReferenceGroupDocument>,
        @InjectModel(CrossReferenceCodeModel.name)
        private readonly codeModel: Model<CrossReferenceCodeDocument>,
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>, // Injected directly for bulk updates
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
    ) { }

    async findGroupById(id: string): Promise<CrossReferenceGroupDocument> {
        return this.groupModel.findById(id);
    }

    async findCodesByGroupId(groupId: string): Promise<CrossReferenceCodeDocument[]> {
        return this.codeModel.find({ groupId: new Types.ObjectId(groupId) });
    }

    /** Products currently linked to a group — see listConflicts for why this
     *  matters for merge review (surfacing origemCatalogo/name lets a reviewer
     *  spot a coincidental partNumber collision between unrelated products). */
    async findProductsByGroupId(groupId: string) {
        return this.productModel
            .find(
                { crossReferenceGroupId: new Types.ObjectId(groupId) },
                { name: 1, slug: 1, origemCatalogo: 1, partNumber: 1, 'brand.name': 1 },
            )
            .lean();
    }

    /**
     * For each (brandKey, codeKey) pair, resolves a matching catalog product
     * (slug + name) if one exists — used by the storefront PDP to turn a
     * cross-reference code into a link when it corresponds to a real,
     * purchasable listing. Single batched query ($or over the distinct
     * pairs) instead of one findOne per code, same reasoning as the
     * existingByKey lookup in processCrossReferences.
     */
    async findLinkedProductsByCodes(
        codes: { brandKey: string; codeKey: string }[],
    ): Promise<Map<string, { slug: string; name: string }>> {
        const result = new Map<string, { slug: string; name: string }>();
        if (codes.length === 0) return result;

        const codeKeys = Array.from(new Set(codes.map((c) => c.codeKey)));
        const products = await this.productModel
            .find(
                { partNumberKey: { $in: codeKeys } },
                { partNumberKey: 1, 'brand.name': 1, slug: 1, name: 1 },
            )
            .lean();

        const bySearchKey = new Map<string, { slug: string; name: string }>();
        for (const p of products as any[]) {
            if (!p.slug || !p.brand?.name) continue;
            const key = `${normalizeBrand(p.brand.name)}::${p.partNumberKey}`;
            bySearchKey.set(key, { slug: p.slug, name: p.name });
        }

        for (const c of codes) {
            const key = `${c.brandKey}::${c.codeKey}`;
            const match = bySearchKey.get(key);
            if (match) result.set(key, match);
        }

        return result;
    }

    async findCodeByBrandAndCode(brand: string, raw: string): Promise<CrossReferenceCodeDocument> {
        return this.codeModel.findOne({ brandKey: normalizeBrand(brand), codeKey: normalizeCode(raw) });
    }

    async createGroup(codes: { brand: string; raw: string }[]): Promise<CrossReferenceGroupDocument> {
        const group = await new this.groupModel({}).save();
        for (const code of codes) {
            await this.insertCode(String(group._id), code.brand, code.raw);
        }
        return group;
    }

    /**
     * Atomic insert of one (brand, code) pair. The unique index on
     * (brand, codeKey) is the actual concurrency guard: under a race, only one
     * caller's insert wins and the others land in the catch below, reading back
     * whichever group actually claimed the code.
     */
    private async insertCode(groupId: string, brand: string, raw: string): Promise<CrossReferenceCodeDocument> {
        const brandKey = normalizeBrand(brand);
        const codeKey = normalizeCode(raw);
        try {
            return await this.codeModel.create({ groupId: new Types.ObjectId(groupId), brand, brandKey, raw, codeKey });
        } catch (e) {
            if ((e as { code?: number })?.code === 11000) {
                const existing = await this.codeModel.findOne({ brandKey, codeKey });
                if (existing) return existing;
            }
            throw e;
        }
    }

    async linkProductToGroup(productId: string, groupId: string) {
        const product = await this.productService.findDocument(productId);
        if (!product) throw new Error('Product not found');

        product.crossReferenceGroupId = new Types.ObjectId(groupId);
        // Sync OEM Codes immediately
        const codes = await this.findCodesByGroupId(groupId);
        product.oemCodes = codes.map((c) => c.raw);
        await (product as any).save();
    }

    /**
     * Main entry point: given a product and a list of equivalent codes, resolve
     * (or create) its group and register every code atomically.
     *
     * Concurrency: resolution no longer depends on "read candidate, then decide,
     * then write" — each code is registered via an atomic upsert against the
     * (brand, codeKey) unique index (insertCode), so parallel imports racing on
     * the same code converge on the same group instead of creating duplicates.
     * Callers no longer need to cluster/sequence products that share a code
     * (see import-catalog.service.ts).
     *
     * Performance: the existing-code lookup and the sibling-owned check are
     * batched into one query each up front (was one `findOne` per reference,
     * sequential — catalogs with products carrying hundreds of references,
     * e.g. ZF Aftermarket's up to 603, made this the dominant cost of an
     * import). Only the actual writes (insertCode/flagConflict) stay
     * per-reference, since each needs its own race-safe unique-index probe.
     */
    async processCrossReferences(productId: string, references: { brand: string; partNumber: string }[]) {
        const product = await this.productService.findDocument(productId);

        let groupId = product.crossReferenceGroupId ? String(product.crossReferenceGroupId) : undefined;

        const ownBrand = product.brand?.name || 'GENERIC';
        const ownBrandKey = normalizeBrand(ownBrand);
        const allRefs = [{ brand: ownBrand, raw: product.partNumber }, ...references.map((r) => ({ brand: r.brand, raw: r.partNumber }))];

        // Dedupe by (brandKey, codeKey) within this call — the array can carry
        // the product's own code twice (explicit self-reference + implicit
        // above), and two references whose brand differs only by casing.
        const seen = new Set<string>();
        const uniqueRefs = allRefs
            .map((r) => ({ brand: r.brand, brandKey: normalizeBrand(r.brand), raw: r.raw, codeKey: normalizeCode(r.raw) }))
            .filter((r) => {
                const key = `${r.brandKey}::${r.codeKey}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

        if (!groupId) {
            const group = await this.groupModel.create({});
            groupId = String(group._id);
        }

        const ownCodeKey = normalizeCode(product.partNumber);

        // One query for every (brandKey, codeKey) this product references,
        // instead of uniqueRefs.length sequential findOnes.
        const existingByKey = new Map<string, CrossReferenceCodeDocument>();
        if (uniqueRefs.length > 0) {
            const existingRows = await this.codeModel.find({
                $or: uniqueRefs.map((r) => ({ brandKey: r.brandKey, codeKey: r.codeKey })),
            });
            for (const row of existingRows) {
                existingByKey.set(`${row.brandKey}::${row.codeKey}`, row);
            }
        }

        // Refs claimed by a group other than this product's own — the only
        // ones that might need the sibling-owned check, batched in one query
        // against the distinct set of foreign groupIds instead of one findOne
        // per ref (see the loop below for the per-brand/product semantics).
        const foreignGroupIds = Array.from(
            new Set(
                uniqueRefs
                    .map((r) => existingByKey.get(`${r.brandKey}::${r.codeKey}`))
                    .filter((existing): existing is CrossReferenceCodeDocument => !!existing && String(existing.groupId) !== groupId)
                    .map((existing) => String(existing.groupId)),
            ),
        );
        const siblingOwnedGroupIds = new Set<string>();
        if (foreignGroupIds.length > 0) {
            const siblingRows = await this.codeModel.find({
                groupId: { $in: foreignGroupIds.map((id) => new Types.ObjectId(id)) },
                brandKey: ownBrandKey,
                codeKey: { $ne: ownCodeKey },
            });
            for (const row of siblingRows) siblingOwnedGroupIds.add(String(row.groupId));
        }

        for (const ref of uniqueRefs) {
            const existing = existingByKey.get(`${ref.brandKey}::${ref.codeKey}`);

            if (!existing) {
                await this.insertCode(groupId, ref.brand, ref.raw);
                continue;
            }

            if (String(existing.groupId) === groupId) {
                // Already a member of this product's group — nothing to do.
                continue;
            }

            // Claimed by a DIFFERENT group. Some manufacturers reuse the same
            // competitor code across genuinely different products of their OWN
            // catalog (e.g. a left/right pair, or two variants a competitor's
            // coarser catalog doesn't distinguish) — merging on that shared
            // code would wrongly conflate two distinct catalog items. If the
            // claiming group already carries another code under THIS
            // product's own brand (i.e. it's already "owned" by a sibling
            // product), skip this one reference silently instead of flagging
            // a conflict — the sibling keeps the code, this product just
            // doesn't gain it. Two DIFFERENT brands genuinely disputing the
            // same code is the real ambiguous case, still flagged below.
            if (siblingOwnedGroupIds.has(String(existing.groupId))) {
                continue;
            }

            // Trusts automatically (append/merge), but flags both groups for
            // manual review — this is the scenario where two catalogs
            // disagree about what a (brand, code) pair refers to.
            await this.flagConflict(groupId, `code ${ref.brand}:${ref.raw} already claimed by group ${existing.groupId}`);
            await this.flagConflict(String(existing.groupId), `code ${ref.brand}:${ref.raw} re-claimed by group ${groupId}`);
        }

        if (String(product.crossReferenceGroupId) !== groupId) {
            await this.linkProductToGroup(productId, groupId);
        } else {
            await this.handleGroupUpdate(groupId);
        }

        return this.groupModel.findById(groupId);
    }

    private async flagConflict(groupId: string, reason: string) {
        await this.groupModel.updateOne(
            { _id: groupId },
            { $set: { status: 'conflict', conflictReason: reason, conflictAt: new Date() } },
        );
    }

    /**
     * Free-text search over ALL cross-reference codes (not scoped to
     * status:'conflict' like listConflicts) — backs the product detail
     * page's "find an existing code/group to pull references from" flow.
     * Same mongot autocomplete index and reasoning as listConflicts (see its
     * comment for why this can't be a plain Mongo $regex at this
     * collection's scale). Returns individual code rows (not grouped) since
     * the caller picks specific codes to copy, not a whole group at once —
     * each row still carries its groupId + the group's linked product(s) so
     * the UI can show "this code belongs to group X, product Y" as context.
     */
    async searchCodes(term: string, limit = 20) {
        const trimmed = term.trim();
        if (!trimmed) return [];

        const hits = await this.codeModel.aggregate([
            {
                $search: {
                    index: 'cross_reference_codes_search',
                    compound: {
                        should: [
                            { autocomplete: { query: trimmed, path: 'raw' } },
                            { autocomplete: { query: trimmed, path: 'brand' } },
                        ],
                    },
                },
            },
            { $limit: limit },
            {
                $lookup: {
                    from: 'products',
                    localField: 'groupId',
                    foreignField: 'crossReferenceGroupId',
                    as: 'products',
                    pipeline: [{ $project: { name: 1, slug: 1, origemCatalogo: 1 } }],
                },
            },
        ]);

        return hits.map((h) => ({
            codeId: h._id,
            groupId: h.groupId,
            brand: h.brand,
            partNumber: h.raw,
            products: h.products ?? [],
        }));
    }

    /**
     * Paginated, single round-trip (aggregation $lookup instead of one
     * findCodesByGroupId query per group — see docs/superpowers/specs/
     * 2026-07-18-cross-reference-groups-restructure-design.md incident notes).
     * Catalog imports (tools/catalog-extractor) can flag hundreds of groups, so an
     * unbounded per-group query loop is not viable here.
     *
     * Also $lookups the product(s) currently linked to each group
     * (crossReferenceGroupId) — a conflict between two totally unrelated
     * products that merely share a partNumber (e.g. a Renault clutch part and
     * an unrelated electrical switch both numbered "6669") is invisible from
     * brand+code alone. Surfacing origemCatalogo/name/slug per group lets the
     * reviewer see at a glance whether the two sides are plausibly the same
     * physical part or a coincidental collision, before merging.
     *
     * `search`, when given, filters to groups containing at least one code
     * whose brand or code CONTAINS the term (matches anywhere, not just a
     * prefix) — via Atlas Search / mongot's "cross_reference_codes_search"
     * autocomplete index on {brand, raw} (see cross-reference-code.schema.ts
     * for why: at this collection's scale, 827k+ docs and no free full-scan
     * budget, a plain Mongo $regex without an anchor is a multi-second-to-
     * tens-of-seconds full collection scan — measured directly, not assumed.
     * mongot's autocomplete tokenizer (nGram-based) answers substring
     * matches like this in tens of milliseconds instead). Two-step because
     * finding matching groupIds via $search first, then paginating
     * groupModel by that id list, is far cheaper than running $search across
     * the *joined* group+codes aggregation pipeline directly.
     */
    async listConflicts(page = 1, limit = 50, search?: string) {
        const skip = (page - 1) * limit;
        const trimmed = search?.trim();

        const matchStage: Record<string, unknown> = { status: 'conflict' };
        if (trimmed) {
            const searchHits = await this.codeModel.aggregate([
                {
                    $search: {
                        index: 'cross_reference_codes_search',
                        compound: {
                            should: [
                                { autocomplete: { query: trimmed, path: 'raw' } },
                                { autocomplete: { query: trimmed, path: 'brand' } },
                            ],
                        },
                    },
                },
                { $limit: 500 },
                { $project: { groupId: 1 } },
            ]);
            const matchingGroupIds = Array.from(new Set(searchHits.map((h) => String(h.groupId)))).map(
                (id) => new Types.ObjectId(id),
            );
            matchStage._id = { $in: matchingGroupIds };
        }

        const [rows, total] = await Promise.all([
            this.groupModel.aggregate([
                { $match: matchStage },
                { $sort: { conflictAt: -1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'cross_reference_codes',
                        localField: '_id',
                        foreignField: 'groupId',
                        as: 'codes',
                    },
                },
                {
                    $lookup: {
                        from: 'products',
                        localField: '_id',
                        foreignField: 'crossReferenceGroupId',
                        as: 'products',
                        pipeline: [{ $project: { name: 1, slug: 1, origemCatalogo: 1, partNumber: 1, 'brand.name': 1 } }],
                    },
                },
            ]),
            this.groupModel.countDocuments(matchStage),
        ]);

        return {
            results: rows.map((r) => ({ group: r, codes: r.codes, products: r.products })),
            total,
            page,
            limit,
        };
    }

    /**
     * Manual resolution of a flagged conflict: mark the group active again
     * (false positive) without touching membership.
     */
    async resolveConflict(groupId: string) {
        await this.groupModel.updateOne(
            { _id: groupId },
            { $set: { status: 'active' }, $unset: { conflictReason: '', conflictAt: '' } },
        );
        return this.groupModel.findById(groupId);
    }

    /**
     * Resolution action for a genuine index conflict (two groups both claiming
     * the same {brandKey, codeKey}): move ONE code row to the group that should
     * own it, re-syncing oemCodes/oemCodesKeys on both groups' products. Unlike
     * resolveConflict (which just clears status without touching membership),
     * this is for when the conflictReason names a specific code that needs to
     * physically move. Does not touch the group's `status` — caller should
     * follow up with resolveConflict once every conflicting code is settled if
     * the group is otherwise fine now.
     */
    async moveCode(codeId: string, targetGroupId: string): Promise<CrossReferenceCodeDocument> {
        const code = await this.codeModel.findById(codeId);
        if (!code) throw new Error('Cross-reference code not found');

        const sourceGroupId = String(code.groupId);
        if (sourceGroupId === targetGroupId) return code;

        code.groupId = new Types.ObjectId(targetGroupId);
        await code.save();

        await this.relinkOwningProduct(sourceGroupId, code.brandKey, code.codeKey, targetGroupId);
        await this.handleGroupUpdate(sourceGroupId);
        await this.handleGroupUpdate(targetGroupId);

        return code;
    }

    /**
     * Explicit "move this product to another group" action — the reviewer
     * picks a product (not a codeId), and this resolves + moves its own
     * implicit self-reference code via moveCode, which already handles
     * re-syncing both groups' oemCodes. Distinct from moveCode itself: that
     * one takes a codeId and is agnostic about whether the row is a
     * self-reference or a citation of another catalog's part; this one is
     * specifically "this product belongs in a different equivalence group",
     * which is the more common shape of a manual conflict resolution (the
     * reviewer knows which PRODUCT is misplaced, not which underlying code
     * row id represents it).
     */
    async moveProductToGroup(productId: string, targetGroupId: string): Promise<CrossReferenceCodeDocument> {
        const product = await this.productService.findDocument(productId);
        if (!product) throw new Error('Product not found');
        if (!product.crossReferenceGroupId) {
            throw new BadRequestException('Este produto ainda não tem um grupo de referência cruzada.');
        }

        const ownBrandKey = normalizeBrand(product.brand?.name || 'GENERIC');
        const code = await this.codeModel.findOne({
            groupId: product.crossReferenceGroupId,
            brandKey: ownBrandKey,
            codeKey: product.partNumberKey,
        });
        if (!code) {
            throw new BadRequestException('Não foi encontrado o código de auto-referência deste produto no grupo atual.');
        }

        return this.moveCode(String(code._id), targetGroupId);
    }

    /**
     * A moved/edited code can be the IMPLICIT SELF-REFERENCE of a product
     * still linked to the group it's leaving (processCrossReferences always
     * auto-registers each product's own {brand, partNumber} as a code row —
     * see its comments). If so, that product's crossReferenceGroupId is left
     * pointing at a group that no longer has ANY row matching its own
     * brand+partNumber — a real product/group mismatch, not just a stale
     * cache, since handleGroupUpdate only re-syncs oemCodes for products
     * already linked to a group and never revisits crossReferenceGroupId
     * itself (confirmed bug: 3-RHO product "6668" kept pointing at the
     * CEMAK/Honda group after its own code row was moved out from under it).
     * Follows the code to targetGroupId so the product's membership matches
     * where its own identity actually lives now.
     */
    private async relinkOwningProduct(sourceGroupId: string, brandKey: string, codeKey: string, targetGroupId: string) {
        const owner = await this.productModel.findOne({
            crossReferenceGroupId: new Types.ObjectId(sourceGroupId),
            partNumberKey: codeKey,
        });
        if (!owner || normalizeBrand(owner.brand?.name || 'GENERIC') !== brandKey) return;

        owner.crossReferenceGroupId = new Types.ObjectId(targetGroupId);
        await owner.save();
    }

    /**
     * Corrects a single code row's own brand and/or partNumber (e.g. the
     * catalog data was wrong: "3-RHO" should have been "Renault", or the
     * digits were mistyped) — as opposed to moveCode, which relocates a row
     * whose (brand, code) is already correct but landed in the wrong group.
     *
     * Unlike processCrossReferences' insert-time collision (which can
     * legitimately "trust and flag" two catalogs disagreeing about a code,
     * since each side is a distinct row from a distinct import), an edit
     * that lands exactly on an existing {brandKey, codeKey} has no such
     * path: the unique index means at most one row can ever hold that pair,
     * so there's nothing to flag-and-keep-both — the edit is rejected
     * outright and the caller must move/merge/discard the existing row
     * first. If no other row claims the corrected pair, the edit applies
     * with no side effects beyond re-syncing this group's products' oemCodes.
     */
    async editCode(codeId: string, changes: { brand?: string; raw?: string }): Promise<CrossReferenceCodeDocument> {
        const code = await this.codeModel.findById(codeId);
        if (!code) throw new Error('Cross-reference code not found');

        const nextBrand = changes.brand?.trim() || code.brand;
        const nextRaw = changes.raw?.trim() || code.raw;
        const nextBrandKey = normalizeBrand(nextBrand);
        const nextCodeKey = normalizeCode(nextRaw);

        if (nextBrandKey === code.brandKey && nextCodeKey === code.codeKey && nextBrand === code.brand && nextRaw === code.raw) {
            return code; // no actual change
        }

        const groupId = String(code.groupId);
        // Excludes this row itself — findOne would otherwise always "find"
        // the row being edited when brand/code aren't both changing.
        const existing = await this.codeModel.findOne({
            _id: { $ne: code._id },
            brandKey: nextBrandKey,
            codeKey: nextCodeKey,
        });

        if (existing) {
            // The unique index on {brandKey, codeKey} makes this pair a hard
            // duplicate regardless of which group holds it — code.save()
            // below would throw a raw E11000 if allowed through. Unlike
            // processCrossReferences' insert-time collision (which can
            // legitimately proceed and flag), an EDIT that lands exactly on
            // an existing pair has no safe "apply and flag" path: there is
            // no way to persist two rows with the same key, so the reviewer
            // must move/merge/discard the existing one first instead.
            throw new BadRequestException(
                `${nextBrand}:${nextRaw} já existe no grupo ${existing.groupId} — mova ou descarte aquele registro antes de aplicar esta correção.`,
            );
        }

        code.brand = nextBrand;
        code.brandKey = nextBrandKey;
        code.raw = nextRaw;
        code.codeKey = nextCodeKey;
        await code.save();

        await this.handleGroupUpdate(groupId);
        return code;
    }

    /**
     * Resolution action for two groups that both genuinely refer to the same
     * physical part — as opposed to moveCode, which is for a single
     * mis-owned code. This happens when two different source products each
     * built their own group (e.g. a Gauss product and a Transpo product,
     * each citing the other's code as a cross-reference) and the flagged
     * conflict is really "these should have been one group all along", not
     * "one side is wrong". Confirmed manually — e.g. against the source
     * catalog's own OEM/similar listing — before calling this, since merging
     * two groups that only coincidentally share one code would wrongly
     * conflate two distinct parts.
     *
     * Moves every code from `sourceGroupId` into `targetGroupId`. A code
     * whose (brandKey, codeKey) already exists in the target (like the one
     * that caused the conflict in the first place) is dropped from the
     * source instead of moved — the target's copy is kept, since it's
     * already correctly linked there. Re-syncs both groups' products and
     * marks `sourceGroupId` `active` (it has no codes left, nothing further
     * to review) — leaves `targetGroupId`'s status for the caller to resolve
     * once satisfied.
     */
    async mergeGroups(sourceGroupId: string, targetGroupId: string): Promise<{ moved: number; dropped: number }> {
        if (sourceGroupId === targetGroupId) return { moved: 0, dropped: 0 };

        const [sourceCodes, targetCodes] = await Promise.all([
            this.codeModel.find({ groupId: new Types.ObjectId(sourceGroupId) }),
            this.codeModel.find({ groupId: new Types.ObjectId(targetGroupId) }),
        ]);
        const targetKeys = new Set(targetCodes.map((c) => `${c.brandKey}::${c.codeKey}`));

        let moved = 0;
        let dropped = 0;
        for (const code of sourceCodes) {
            const key = `${code.brandKey}::${code.codeKey}`;
            if (targetKeys.has(key)) {
                await this.codeModel.deleteOne({ _id: code._id });
                dropped++;
            } else {
                code.groupId = new Types.ObjectId(targetGroupId);
                await code.save();
                moved++;
            }
        }

        // Re-point every product still linked to the source group — it has
        // no codes left after the moves above, so handleGroupUpdate alone
        // (which only touches oemCodes/oemCodesKeys, never
        // crossReferenceGroupId) would leave these products orphaned
        // pointing at an empty group instead of following their codes to
        // the merged target.
        await this.productModel.updateMany(
            { crossReferenceGroupId: new Types.ObjectId(sourceGroupId) },
            { $set: { crossReferenceGroupId: new Types.ObjectId(targetGroupId) } },
        );

        await this.handleGroupUpdate(targetGroupId);
        await this.groupModel.updateOne(
            { _id: sourceGroupId },
            { $set: { status: 'active' }, $unset: { conflictReason: '', conflictAt: '' } },
        );

        return { moved, dropped };
    }

    /**
     * Product-page counterpart to the admin conflicts queue's "Mesclar":
     * merges one or more OTHER groups (found via search) into this
     * product's own group. Exists because automatic conflict detection only
     * catches two groups disputing the exact same {brand, code} pair — two
     * groups that are plausibly the same physical part but happen to cite
     * DIFFERENT OEM/reference codes (e.g. a Indisa engine part and a Taranto
     * part for the same Fiat Idea engine, sharing "FIAT:55229969" but not
     * literally colliding on any single code) never get flagged as a
     * conflict at all, so there's nothing to merge from the conflicts queue.
     * The reviewer recognizing "these are the same part" from the product
     * page is the actual signal here — this just needs to accept it
     * directly instead of routing through processCrossReferences (which
     * would try to copy individual codes and hit the same "can't duplicate
     * a code already owned by another group" wall covered by the toast in
     * the frontend's confirmImportSelected).
     *
     * Ensures the product has its own group first (creates one via
     * processCrossReferences with no extra references if it doesn't), then
     * merges each source group into it via mergeGroups — same code-and-
     * product reconciliation guarantees as the admin flow.
     */
    async mergeGroupsIntoProduct(productId: string, sourceGroupIds: string[]) {
        const product = await this.productService.findDocument(productId);
        if (!product) throw new Error('Product not found');

        let targetGroupId = product.crossReferenceGroupId ? String(product.crossReferenceGroupId) : undefined;
        if (!targetGroupId) {
            const group = await this.processCrossReferences(productId, []);
            targetGroupId = String(group._id);
        }

        let totalMoved = 0;
        let totalDropped = 0;
        for (const sourceGroupId of sourceGroupIds) {
            if (sourceGroupId === targetGroupId) continue;
            const { moved, dropped } = await this.mergeGroups(sourceGroupId, targetGroupId);
            totalMoved += moved;
            totalDropped += dropped;
        }

        return { groupId: targetGroupId, moved: totalMoved, dropped: totalDropped };
    }

    /**
     * Resolution action for ghost-brand noise (design doc 4.1): remove a
     * `cross_reference_codes` row outright — used when it's a duplicate of
     * another row in the same group under a real brand (e.g. "SIMILAR:GA018"
     * once "GAUSS:GA018" already covers the same part). Never changes group
     * `status`, since this class of row never triggered the unique-index
     * conflict in the first place.
     *
     * Warns (rather than silently allowing) when the row being discarded is
     * a product's own IMPLICIT SELF-REFERENCE (processCrossReferences always
     * auto-registers each linked product's own {brand, partNumber} — see its
     * comments): discarding it erases the product's own identity from the
     * group with no way to reconstruct it, unlike a regular cross-reference
     * to another catalog's code. But the source catalog's own brand/code for
     * a product IS sometimes simply wrong at import time (a data-entry
     * error, not a real equivalence claim) — that's not something the
     * reviewer can fix by editing a cross-reference row on some OTHER
     * product; it has to go via this exact row. So this is a `force`-gated
     * confirmation, not an outright block: by default throws (safe default,
     * matches the ghost-brand discard flow which never hits this case
     * either — those rows are always a duplicate placeholder brand, never a
     * product's own), but `force: true` proceeds once the caller has
     * explicitly confirmed with the human that the catalog data was wrong.
     */
    async discardCode(codeId: string, force = false): Promise<void> {
        const code = await this.codeModel.findById(codeId);
        if (!code) throw new Error('Cross-reference code not found');

        const groupId = String(code.groupId);
        const owner = await this.productModel.findOne({
            crossReferenceGroupId: new Types.ObjectId(groupId),
            partNumberKey: code.codeKey,
        });
        if (owner && normalizeBrand(owner.brand?.name || 'GENERIC') === code.brandKey && !force) {
            throw new BadRequestException(
                `${code.brand}:${code.raw} é a própria referência do produto "${owner.name}". Se o catálogo errou esse dado, confirme a remoção explicitamente.`,
            );
        }

        await this.codeModel.deleteOne({ _id: code._id });
        await this.handleGroupUpdate(groupId);
    }

    /**
     * Bulk variant of discardCode, for the admin "select all / deselect
     * false positives, discard the rest" flow (design doc 5.1 — discard
     * stays a human decision, but reviewing 162 rows doesn't mean 162
     * separate clicks). Still requires an explicit id list from the caller;
     * there is deliberately no "discard every flagged row" without the
     * caller having fetched and seen the list first.
     */
    async discardCodes(codeIds: string[]): Promise<{ discarded: number }> {
        if (codeIds.length === 0) return { discarded: 0 };

        const objectIds = codeIds.map((id) => new Types.ObjectId(id));
        const codes = await this.codeModel.find({ _id: { $in: objectIds } });
        const groupIds = Array.from(new Set(codes.map((c) => String(c.groupId))));

        const result = await this.codeModel.deleteMany({ _id: { $in: objectIds } });
        for (const groupId of groupIds) {
            await this.handleGroupUpdate(groupId);
        }

        return { discarded: result.deletedCount ?? 0 };
    }

    /**
     * Lists ghost-brand duplicate candidates flagged by the migration backfill
     * (design doc 5.1) — separate surface from listConflicts, since these
     * never carried status:'conflict'. Paginated for the same reason as
     * listConflicts (catalog-scale volume).
     */
    async listGhostBrandCandidates(page = 1, limit = 50) {
        const skip = (page - 1) * limit;
        const [rows, total] = await Promise.all([
            this.codeModel
                .find({ flaggedAsGhostBrand: true })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            this.codeModel.countDocuments({ flaggedAsGhostBrand: true }),
        ]);

        const duplicateIds = rows.map((r) => r.ghostBrandDuplicateOf).filter((id): id is Types.ObjectId => !!id);
        const duplicates = duplicateIds.length
            ? await this.codeModel.find({ _id: { $in: duplicateIds } })
            : [];
        const duplicateById = new Map(duplicates.map((d) => [String(d._id), d]));

        return {
            results: rows.map((row) => ({
                codeId: row._id,
                groupId: row.groupId,
                brand: row.brand,
                partNumber: row.raw,
                duplicateOf: row.ghostBrandDuplicateOf
                    ? (() => {
                        const dup = duplicateById.get(String(row.ghostBrandDuplicateOf));
                        return dup ? { codeId: dup._id, brand: dup.brand, partNumber: dup.raw } : null;
                    })()
                    : null,
            })),
            total,
            page,
            limit,
        };
    }

    // --- Kit ↔ component relations (groupType: 'kit') ---
    // See docs/superpowers/specs/2026-07-24-kit-component-relations-design.md.
    // Reuses the same group/code collections as equivalence cross-references,
    // discriminated by groupType/role, instead of a parallel schema.

    /**
     * Resolves the products (slug/name/price/image/brand — enough for a
     * storefront ProductCard) referenced by a set of {brandKey, codeKey}
     * pairs. Unlike findLinkedProductsByCodes (which only returns slug+name
     * for a reference chip), this returns the full card-friendly shape for
     * the "peças deste conjunto" / "conjunto completo" sections.
     */
    private async resolveProductCards(
        codes: { brandKey: string; codeKey: string }[],
    ): Promise<Map<string, Record<string, unknown>>> {
        const result = new Map<string, Record<string, unknown>>();
        if (codes.length === 0) return result;

        const codeKeys = Array.from(new Set(codes.map((c) => c.codeKey)));
        const products = await this.productModel
            .find(
                { partNumberKey: { $in: codeKeys } },
                {
                    partNumberKey: 1,
                    'brand.name': 1,
                    'brand.isGenuine': 1,
                    'brand.logoUrl': 1,
                    slug: 1,
                    name: 1,
                    titleText: 1,
                    subtitle: 1,
                    partNumber: 1,
                    price: 1,
                    listPrice: 1,
                    images: 1,
                    ratingAverage: 1,
                    ratingCount: 1,
                    totalSold: 1,
                    stockQuantity: 1,
                    quantity: 1,
                },
            )
            .lean();

        const bySearchKey = new Map<string, Record<string, unknown>>();
        for (const p of products as any[]) {
            if (!p.slug || !p.brand?.name) continue;
            const key = `${normalizeBrand(p.brand.name)}::${p.partNumberKey}`;
            bySearchKey.set(key, { ...p, _id: String(p._id) });
        }

        for (const c of codes) {
            const key = `${c.brandKey}::${c.codeKey}`;
            const match = bySearchKey.get(key);
            if (match) result.set(key, match);
        }

        return result;
    }

    /**
     * Given a product, returns its kit relations in whichever direction
     * applies: if it's the complete assembly (role:'kit'), the resolved
     * components; if it's a component (role:'component'), the resolved
     * complete assembly/assemblies. A product can appear in both roles
     * across different groups — the schema doesn't forbid it (e.g. a
     * sub-assembly that's also sold as part of a larger kit) — so both
     * lists are returned, empty when not applicable.
     */
    async getKitRelations(productId: string) {
        const product = await this.productService.findDocument(productId);
        if (!product) return { components: [], kits: [] };

        const ownBrandKey = normalizeBrand(product.brand?.name || 'GENERIC');
        const ownCodeKey = normalizeCode(product.partNumber);

        const ownRows = await this.codeModel.find({
            brandKey: ownBrandKey,
            codeKey: ownCodeKey,
            role: { $in: ['kit', 'component'] },
        });
        if (ownRows.length === 0) return { components: [], kits: [] };

        const kitGroupIds = ownRows.filter((r) => r.role === 'kit').map((r) => r.groupId);
        const componentGroupIds = ownRows.filter((r) => r.role === 'component').map((r) => r.groupId);

        const [componentRows, kitRows] = await Promise.all([
            kitGroupIds.length
                ? this.codeModel.find({ groupId: { $in: kitGroupIds }, role: 'component' })
                : Promise.resolve([]),
            componentGroupIds.length
                ? this.codeModel.find({ groupId: { $in: componentGroupIds }, role: 'kit' })
                : Promise.resolve([]),
        ]);

        const [componentCards, kitCards] = await Promise.all([
            this.resolveProductCards(componentRows.map((r) => ({ brandKey: r.brandKey, codeKey: r.codeKey }))),
            this.resolveProductCards(kitRows.map((r) => ({ brandKey: r.brandKey, codeKey: r.codeKey }))),
        ]);

        const withRowMeta = (card: Record<string, unknown> | undefined, r: CrossReferenceCodeDocument) =>
            card ? { ...card, groupId: String(r.groupId), codeId: String(r._id) } : undefined;

        return {
            components: componentRows
                .map((r) => withRowMeta(componentCards.get(`${r.brandKey}::${r.codeKey}`), r))
                .filter(Boolean),
            kits: kitRows
                .map((r) => withRowMeta(kitCards.get(`${r.brandKey}::${r.codeKey}`), r))
                .filter(Boolean),
        };
    }

    /**
     * Creates or extends a kit group for `kitProductId`: registers it as the
     * 'kit' member (idempotent — reuses the existing group if this product
     * is already the kit of one) and adds each of `componentProductIds` as a
     * 'component' member. A code already registered under {brandKey,
     * codeKey} anywhere (kit or equivalence) is left untouched instead of
     * moved — same "never silently steal a code" posture as
     * processCrossReferences, but surfaced as an explicit error here since
     * this is an admin-driven single action, not a bulk import.
     */
    async setKitComponents(kitProductId: string, componentProductIds: string[]) {
        const kitProduct = await this.productService.findDocument(kitProductId);
        if (!kitProduct) throw new Error('Kit product not found');

        const kitBrandKey = normalizeBrand(kitProduct.brand?.name || 'GENERIC');
        const kitCodeKey = normalizeCode(kitProduct.partNumber);

        let existingKitRow = await this.codeModel.findOne({ brandKey: kitBrandKey, codeKey: kitCodeKey });
        let groupId: string;

        if (existingKitRow && existingKitRow.role === 'kit') {
            groupId = String(existingKitRow.groupId);
        } else if (existingKitRow) {
            throw new Error(
                `Product ${kitProductId} code is already registered with a different role/group (${existingKitRow.role ?? 'equivalence'})`,
            );
        } else {
            const group = await this.groupModel.create({ groupType: 'kit' });
            groupId = String(group._id);
            await this.codeModel.create({
                groupId: new Types.ObjectId(groupId),
                brand: kitProduct.brand?.name || 'GENERIC',
                brandKey: kitBrandKey,
                raw: kitProduct.partNumber,
                codeKey: kitCodeKey,
                role: 'kit',
            });
        }

        for (const componentId of componentProductIds) {
            const component = await this.productService.findDocument(componentId);
            if (!component) continue;

            const brandKey = normalizeBrand(component.brand?.name || 'GENERIC');
            const codeKey = normalizeCode(component.partNumber);

            const existing = await this.codeModel.findOne({ brandKey, codeKey });
            if (existing) {
                if (String(existing.groupId) === groupId && existing.role === 'component') continue;
                throw new Error(
                    `Component ${componentId} code is already registered with a different role/group (${existing.role ?? 'equivalence'})`,
                );
            }

            await this.codeModel.create({
                groupId: new Types.ObjectId(groupId),
                brand: component.brand?.name || 'GENERIC',
                brandKey,
                raw: component.partNumber,
                codeKey,
                role: 'component',
            });
        }

        return this.groupModel.findById(groupId);
    }

    /** Removes a single component's code row from a kit group. Does not touch the kit row itself. */
    async removeKitComponent(groupId: string, componentCodeId: string): Promise<void> {
        await this.codeModel.deleteOne({ _id: componentCodeId, groupId: new Types.ObjectId(groupId), role: 'component' });
    }

    /** Removes an entire kit group (the kit row and every component row). */
    async removeKitGroup(groupId: string): Promise<void> {
        await this.codeModel.deleteMany({ groupId: new Types.ObjectId(groupId) });
        await this.groupModel.deleteOne({ _id: groupId, groupType: 'kit' });
    }

    /**
     * When a group's membership changes, re-sync oemCodes/oemCodesKeys on every
     * linked product.
     */
    private async handleGroupUpdate(groupId: string) {
        const codes = await this.findCodesByGroupId(groupId);
        const rawCodes = codes.map((c) => c.raw);
        const codeKeys = codes.map((c) => c.codeKey);

        await this.productModel.updateMany(
            { crossReferenceGroupId: new Types.ObjectId(groupId) },
            { $set: { oemCodes: rawCodes, oemCodesKeys: codeKeys } },
        );
    }
}
