/**
 * READ-ONLY diagnostic: measures how well questions are linked to local products,
 * and how many distinct ML items would force a per-item ML API call (getItem) on
 * the current resolveProductId() fallback path.
 *
 * Writes NOTHING. Only counts/aggregates. Safe to run against production Atlas.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/measure-question-product-coverage.ts
 *
 * Options (env vars):
 *   MARKETPLACE_ID=xxx  — restrict to a specific marketplace
 *   SAMPLE=20           — how many unresolved itemIds to print as examples (default 20)
 *
 * What it answers:
 *   1. % of questions with product resolved (product != null) vs unresolved.
 *   2. Among unresolved questions, how many DISTINCT itemIds exist — these are the
 *      items that, lacking a local Listing, trigger getItem() against the ML API.
 *      A high "questions per distinct item" ratio means the current code re-fetches
 *      the same item from ML repeatedly (no cache) → the real hotspot.
 *   3. How many of those distinct unresolved itemIds DO have a Listing locally
 *      (resolvable cheaply, no API) vs genuinely missing (API-only).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuestionModel } from '../src/questions/schemas/question.schema';
import { ListingModel } from '../src/listing/schemas/listing.schema';

const FILTER_MARKETPLACE = process.env.MARKETPLACE_ID || null;
const SAMPLE = parseInt(process.env.SAMPLE || '20', 10);

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
    });

    try {
        const questionModel = app.get<Model<QuestionModel>>(getModelToken(QuestionModel.name));
        const listingModel = app.get<Model<ListingModel>>(getModelToken(ListingModel.name));

        const baseMatch: any = {};
        if (FILTER_MARKETPLACE) {
            baseMatch.marketplaceId = new Types.ObjectId(FILTER_MARKETPLACE);
            console.log(`Filtering by marketplaceId: ${FILTER_MARKETPLACE}`);
        }

        // ── 1. Overall coverage ────────────────────────────────────────────────
        const total = await questionModel.countDocuments(baseMatch);
        const resolved = await questionModel.countDocuments({
            ...baseMatch,
            product: { $ne: null },
        });
        const unresolved = total - resolved;
        const pct = (n: number) => (total === 0 ? '0.0' : ((n / total) * 100).toFixed(1));

        console.log('─────────────────────────────────────────────');
        console.log(`TOTAL questions:        ${total}`);
        console.log(`  with product linked:  ${resolved} (${pct(resolved)}%)`);
        console.log(`  WITHOUT product:      ${unresolved} (${pct(unresolved)}%)`);

        // ── 2. Distinct itemIds among unresolved (= getItem() pressure) ─────────
        const unresolvedItems: { _id: string; count: number }[] = await questionModel.aggregate([
            { $match: { ...baseMatch, product: null, itemId: { $ne: null } } },
            { $group: { _id: '$itemId', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);

        const distinctUnresolvedItems = unresolvedItems.length;
        const unresolvedWithItemId = unresolvedItems.reduce((acc, r) => acc + r.count, 0);
        const ratio =
            distinctUnresolvedItems === 0
                ? '0.00'
                : (unresolvedWithItemId / distinctUnresolvedItems).toFixed(2);

        console.log('─────────────────────────────────────────────');
        console.log(`Unresolved questions WITH an itemId: ${unresolvedWithItemId}`);
        console.log(`  distinct itemIds:                  ${distinctUnresolvedItems}`);
        console.log(`  questions per distinct item:       ${ratio}  (>1 ⇒ current code re-calls getItem for the same item)`);

        // ── 3. Of those distinct items, how many ARE resolvable via local Listing?
        //    (cheap, indexed lookup — no API). The rest are API-only (or unlinkable).
        let resolvableViaListing = 0;
        let apiOnly = 0;
        const apiOnlyExamples: { itemId: string; questions: number }[] = [];

        for (const row of unresolvedItems) {
            const itemId = row._id;
            const listingQuery: any = { externalId: itemId };
            if (FILTER_MARKETPLACE) listingQuery.marketplaceId = new Types.ObjectId(FILTER_MARKETPLACE);

            const listing = await listingModel
                .findOne(listingQuery)
                .select('_id productId')
                .lean()
                .exec();

            if (listing && (listing as any).productId) {
                resolvableViaListing++;
            } else {
                apiOnly++;
                if (apiOnlyExamples.length < SAMPLE) {
                    apiOnlyExamples.push({ itemId, questions: row.count });
                }
            }
        }

        console.log('─────────────────────────────────────────────');
        console.log(`Distinct unresolved itemIds breakdown:`);
        console.log(`  resolvable via local Listing (NO API needed): ${resolvableViaListing}`);
        console.log(`    → these are linked questions only because upsert never re-ran resolveProductId`);
        console.log(`  API-only / unlinkable (getItem fires):        ${apiOnly}`);

        if (apiOnlyExamples.length > 0) {
            console.log('─────────────────────────────────────────────');
            console.log(`Sample of API-only itemIds (up to ${SAMPLE}):`);
            for (const ex of apiOnlyExamples) {
                console.log(`  ${ex.itemId}  — ${ex.questions} question(s) hitting getItem`);
            }
        }

        console.log('─────────────────────────────────────────────');
        console.log('INTERPRETATION:');
        console.log('  • High % linked + low API-only count  ⇒ inline resolve + small cache is enough.');
        console.log('  • High API-only count or high ratio    ⇒ need listing backfill + negative cache.');
    } finally {
        await app.close();
    }
}

bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
