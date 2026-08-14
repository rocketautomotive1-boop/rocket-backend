/**
 * One-time, idempotent backfill: Product.catalogKitComponents (raw partNumbers
 * from source-catalog CONJ_PRODS/kit tables — Schaeffler, Dayco, Denso, Mahle,
 * Taranto, Spaal, ZF Aftermarket at time of writing) → cross_reference_groups
 * (groupType:'kit') / cross_reference_codes (role:'kit'|'component').
 *
 * See docs/superpowers/specs/2026-07-24-kit-component-relations-design.md.
 * Standalone (no Nest DI), same pattern as backfill-pricing.ts. Run:
 *   npx ts-node -r tsconfig-paths/register src/product/migration/backfill-kit-components.ts
 *
 * partNumbers that don't resolve to a real product (catalog cites a component
 * not itself imported) are skipped silently — same tolerant posture as every
 * other catalog backfill. Re-running is a no-op for products already
 * registered with role:'kit'.
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

function normalizeCode(raw: string): string {
    return (raw || '').trim().toUpperCase().replace(/[\s\-.]/g, '');
}

function normalizeBrand(raw: string): string {
    return (raw || '').trim().toUpperCase();
}

async function run() {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI not set');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();

    const products = db.collection('products');
    const groups = db.collection('cross_reference_groups');
    const codes = db.collection('cross_reference_codes');

    const cursor = products.find(
        { catalogKitComponents: { $exists: true, $not: { $size: 0 } } },
        { projection: { partNumber: 1, 'brand.name': 1, catalogKitComponents: 1 } },
    );

    let groupsCreated = 0;
    let skippedAlreadyRegistered = 0;
    let componentsLinked = 0;
    let componentsUnresolved = 0;
    let componentsSkippedAlreadyLinked = 0;

    for await (const p of cursor) {
        const brandName = (p as any).brand?.name || 'GENERIC';
        const brandKey = normalizeBrand(brandName);
        const codeKey = normalizeCode((p as any).partNumber);

        const existing = await codes.findOne({ brandKey, codeKey });
        if (existing) {
            // Already registered (as kit, component, or equivalence) — don't touch.
            skippedAlreadyRegistered++;
            continue;
        }

        const componentPartNumbers: string[] = ((p as any).catalogKitComponents || [])
            .map((c: { partNumber?: string }) => c.partNumber)
            .filter(Boolean);
        if (componentPartNumbers.length === 0) continue;

        const componentCodeKeys = Array.from(new Set(componentPartNumbers.map(normalizeCode)));
        const allResolvedComponents = await products
            .find(
                { partNumberKey: { $in: componentCodeKeys } },
                { projection: { partNumber: 1, 'brand.name': 1, partNumberKey: 1 } },
            )
            .toArray();

        // Some source catalogs list the kit product itself among its own
        // CONJ_PRODS rows (e.g. Spaal 60.854-OR-ML citing 60.854-OR-ML) —
        // a self-reference, not a real component. Drop it before linking,
        // same posture as CrossReferenceController's own-code filter.
        const resolvedComponents = allResolvedComponents.filter(
            (comp) => !(normalizeBrand((comp as any).brand?.name || 'GENERIC') === brandKey && (comp as any).partNumberKey === codeKey),
        );

        componentsUnresolved += componentPartNumbers.length - resolvedComponents.length;
        if (resolvedComponents.length === 0) continue;

        // A component can legitimately belong to more than one kit (e.g. the
        // same bearing sold inside two different alternator kits) — but the
        // {brandKey, codeKey} unique index is global (one row per code,
        // period), so a component already registered under ANY group (this
        // one or another kit/equivalence group) is skipped rather than
        // inserted again. This under-represents "shared component of
        // multiple kits" (only the first kit backfilled keeps the link) —
        // acceptable for this backfill; the admin UI (setKitComponents)
        // surfaces the same constraint explicitly for manual curation.
        const newComponents: { brand: string; brandKey: string; raw: string; codeKey: string }[] = [];
        for (const comp of resolvedComponents) {
            const compBrandName = (comp as any).brand?.name || 'GENERIC';
            const compBrandKey = normalizeBrand(compBrandName);
            const compCodeKey = (comp as any).partNumberKey;

            const existingComponent = await codes.findOne({ brandKey: compBrandKey, codeKey: compCodeKey });
            if (existingComponent) {
                componentsSkippedAlreadyLinked++;
                continue;
            }
            newComponents.push({ brand: compBrandName, brandKey: compBrandKey, raw: (comp as any).partNumber, codeKey: compCodeKey });
        }

        if (newComponents.length === 0) continue;

        const group = await groups.insertOne({
            groupType: 'kit',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        groupsCreated++;

        await codes.insertOne({
            groupId: group.insertedId,
            brand: brandName,
            brandKey,
            raw: (p as any).partNumber,
            codeKey,
            role: 'kit',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        for (const comp of newComponents) {
            await codes.insertOne({
                groupId: group.insertedId,
                brand: comp.brand,
                brandKey: comp.brandKey,
                raw: comp.raw,
                codeKey: comp.codeKey,
                role: 'component',
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            componentsLinked++;
        }
    }

    console.log(`[backfill-kit-components] kit groups created: ${groupsCreated}`);
    console.log(`[backfill-kit-components] components linked: ${componentsLinked}`);
    console.log(`[backfill-kit-components] components unresolved (no matching product): ${componentsUnresolved}`);
    console.log(`[backfill-kit-components] components skipped (code already linked elsewhere): ${componentsSkippedAlreadyLinked}`);
    console.log(`[backfill-kit-components] products skipped (kit code already registered): ${skippedAlreadyRegistered}`);

    await client.close();
    console.log('[backfill-kit-components] done.');
}

run().catch((e) => {
    console.error('[backfill-kit-components] FAILED:', e);
    process.exit(1);
});
