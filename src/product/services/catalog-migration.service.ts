
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CrossReferenceGroupModel, CrossReferenceGroupDocument } from '../schemas/cross-reference-group.schema';
import { CrossReferenceCodeModel, CrossReferenceCodeDocument } from '../schemas/cross-reference-code.schema';
import { normalizeCode, normalizeBrand, isGhostBrand } from '../utils/code-key.util';

@Injectable()
export class CatalogMigrationService {
    private readonly logger = new Logger(CatalogMigrationService.name);

    constructor(
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
        @InjectModel(CrossReferenceGroupModel.name)
        private readonly groupModel: Model<CrossReferenceGroupDocument>,
        @InjectModel(CrossReferenceCodeModel.name)
        private readonly codeModel: Model<CrossReferenceCodeDocument>,
    ) { }

    /**
     * Backfills Product.partNumberKey from Product.partNumber for documents that
     * predate the partNumberKey field (see docs/superpowers/specs/
     * 2026-07-18-cross-reference-groups-restructure-design.md, section 5).
     */
    async migratePartNumberKeys() {
        this.logger.log('Starting partNumberKey backfill...');

        const cursor = this.productModel
            .find({ partNumber: { $exists: true, $ne: null }, partNumberKey: { $exists: false } })
            .cursor();

        let count = 0;
        let updated = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            count++;
            try {
                doc.partNumberKey = normalizeCode(doc.partNumber);
                await doc.save();
                updated++;
            } catch (error) {
                this.logger.error(`Failed to backfill partNumberKey for product ${doc._id}: ${error.message}`);
            }
        }

        this.logger.log(`partNumberKey backfill finished. Scanned: ${count}. Updated: ${updated}.`);
        return { scanned: count, updated };
    }

    /**
     * One-off migration: reads the OLD embedded `codes[]` array still present on
     * legacy `cross_reference_groups` documents (pre-restructure) and inserts each
     * code into the new `cross_reference_codes` collection. Safe to re-run — codes
     * already migrated are skipped by the (brand, codeKey) unique index.
     *
     * `dryRun: true` only counts what WOULD be inserted/conflicted, without writing
     * anything — use this first to size the conflict volume (see design doc) before
     * running for real.
     */
    async migrateCrossReferenceCodes(options: { dryRun?: boolean } = {}) {
        const dryRun = !!options.dryRun;
        this.logger.log(`Starting cross-reference codes migration (dryRun=${dryRun})...`);

        // Legacy documents may still carry the old embedded `codes` array even
        // though it's no longer declared on CrossReferenceGroupModel — read it via
        // the raw collection to avoid the schema silently dropping it.
        const cursor = this.groupModel.collection.find<{ _id: Types.ObjectId; codes?: { brand: string; partNumber: string }[] }>({
            codes: { $exists: true },
        });

        let groupsScanned = 0;
        let codesInserted = 0;
        let codesConflicted = 0;

        while (await cursor.hasNext()) {
            const legacyGroup = await cursor.next();
            if (!legacyGroup?.codes?.length) continue;
            groupsScanned++;
            const groupId = legacyGroup._id;

            for (const code of legacyGroup.codes) {
                const brandKey = normalizeBrand(code.brand);
                const codeKey = normalizeCode(code.partNumber);
                const existing = await this.codeModel.findOne({ brandKey, codeKey });

                if (existing) {
                    if (String(existing.groupId) !== String(groupId)) {
                        codesConflicted++;
                        if (!dryRun) {
                            await this.flagConflict(String(groupId), `migration: ${code.brand}:${code.partNumber} already claimed by group ${existing.groupId}`);
                            await this.flagConflict(String(existing.groupId), `migration: ${code.brand}:${code.partNumber} re-claimed by group ${groupId}`);
                        }
                    }
                    continue;
                }

                codesInserted++;
                if (!dryRun) {
                    await this.codeModel.create({ groupId, brand: code.brand, brandKey, raw: code.partNumber, codeKey });
                }
            }
        }

        this.logger.log(
            `Cross-reference codes migration finished. Groups scanned: ${groupsScanned}. Codes inserted: ${codesInserted}. Conflicts: ${codesConflicted}.`,
        );
        return { groupsScanned, codesInserted, codesConflicted, dryRun };
    }

    private async flagConflict(groupId: string, reason: string) {
        await this.groupModel.updateOne(
            { _id: groupId },
            { $set: { status: 'conflict', conflictReason: reason, conflictAt: new Date() } },
        );
    }

    /**
     * Step 2.1 (design doc section 5.1): scans every group's codes for
     * ghost-brand duplicates — same codeKey appearing twice in one group,
     * once under a known ghost brand (SIMILAR, DIVERSOS, ...) and once under
     * a real, named brand. Flags the ghost-brand row for review; never
     * deletes anything itself. Idempotent (re-flags the same rows, no-ops on
     * rows already flagged or already discarded).
     *
     * dryRun: true only counts candidates, without writing the flag.
     */
    async flagGhostBrandDuplicates(options: { dryRun?: boolean } = {}) {
        const dryRun = !!options.dryRun;
        this.logger.log(`Starting ghost-brand duplicate flagging (dryRun=${dryRun})...`);

        const cursor = this.codeModel.aggregate([
            { $group: { _id: { groupId: '$groupId', codeKey: '$codeKey' }, rows: { $push: '$$ROOT' } } },
            { $match: { 'rows.1': { $exists: true } } },
        ]).cursor();

        let groupsWithDuplicateCodeKey = 0;
        let flagged = 0;

        for (let entry = await cursor.next(); entry != null; entry = await cursor.next()) {
            const rows = entry.rows as (CrossReferenceCodeDocument & { brandKey: string })[];
            const ghostRows = rows.filter((r) => isGhostBrand(r.brandKey));
            const realRows = rows.filter((r) => !isGhostBrand(r.brandKey));
            if (ghostRows.length === 0 || realRows.length === 0) continue;

            groupsWithDuplicateCodeKey++;
            const realRow = realRows[0];

            for (const ghostRow of ghostRows) {
                flagged++;
                if (!dryRun) {
                    await this.codeModel.updateOne(
                        { _id: ghostRow._id },
                        { $set: { flaggedAsGhostBrand: true, ghostBrandDuplicateOf: realRow._id } },
                    );
                }
            }
        }

        this.logger.log(
            `Ghost-brand duplicate flagging finished. Groups with duplicate codeKey: ${groupsWithDuplicateCodeKey}. Rows flagged: ${flagged}.`,
        );
        return { groupsWithDuplicateCodeKey, flagged, dryRun };
    }

    /**
     * One-off backfill: sets active:true on every Product currently
     * active:false. Catalog imports (import-catalog.service.ts) used to set
     * active:false on insert, which kept every imported product out of
     * storefront/search listings (findForStore, ProductFilterService,
     * ProductRailsService, ProductVehicleSearchService all filter on
     * active:true) — that default has since been changed to active:true for
     * new imports, but the ~100k+ products already imported under the old
     * default stay hidden until backfilled. active does NOT gate marketplace
     * sync/readiness (that's readyToPublish, computed independently) and does
     * NOT require stock or price — the user wants these visible/searchable
     * even without stock.
     *
     * NOTE (explicit user decision, not a default): `active:false` is ALSO
     * used as manual soft-delete (`ProductService.remove()`). There is no
     * reliable field to distinguish "never activated after catalog import"
     * from "deliberately removed by a human" — both look identical
     * (`active:false`) in the data. This backfill activates ALL of them
     * without exception, per explicit instruction. Any product a user
     * intentionally removed via the app will come back to
     * search/storefront visibility as a side effect.
     *
     * `dryRun: true` only counts, without writing.
     */
    async activateAllInactiveProducts(options: { dryRun?: boolean } = {}) {
        const dryRun = !!options.dryRun;
        this.logger.log(`Starting active:true backfill (dryRun=${dryRun})...`);

        const matched = await this.productModel.countDocuments({ active: false });

        let modifiedCount = 0;
        if (!dryRun) {
            const result = await this.productModel.updateMany({ active: false }, { $set: { active: true } });
            modifiedCount = result.modifiedCount ?? 0;
        }

        this.logger.log(`active:true backfill finished. Matched: ${matched}. Modified: ${modifiedCount}.`);
        return { matched, modified: modifiedCount, dryRun };
    }

    /**
     * Recomputes Product.oemCodes (raw) and Product.oemCodesKeys (normalized) from
     * the new cross_reference_codes collection, for every product linked to a
     * group. Supersedes the old migrateOemCodes (which read the embedded array).
     */
    async migrateOemCodes() {
        this.logger.log('Starting OEM Codes migration...');

        const cursor = this.productModel.find({
            crossReferenceGroupId: { $exists: true, $ne: null }
        }).cursor();

        let count = 0;
        let updated = 0;

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            count++;
            try {
                const codes = await this.codeModel.find({ groupId: doc.crossReferenceGroupId });
                if (codes.length > 0) {
                    const rawCodes = codes.map((c) => c.raw);
                    const codeKeys = codes.map((c) => c.codeKey);

                    const currentCodes = doc.oemCodes || [];
                    const isSame = rawCodes.length === currentCodes.length &&
                        [...rawCodes].sort().every((val, index) => val === [...currentCodes].sort()[index]);

                    if (!isSame) {
                        doc.oemCodes = rawCodes;
                        (doc as any).oemCodesKeys = codeKeys;
                        await doc.save();
                        updated++;
                        if (updated % 100 === 0) {
                            this.logger.log(`Updated ${updated} products so far...`);
                        }
                    }
                }
            } catch (error) {
                this.logger.error(`Failed to migrate product ${doc._id}: ${error.message}`);
            }
        }

        this.logger.log(`Migration finished. Scanned: ${count}. Updated: ${updated}.`);
        return { scanned: count, updated };
    }
}
