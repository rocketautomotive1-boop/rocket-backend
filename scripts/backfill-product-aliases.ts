/**
 * Backfill ProductAlias for all Listings that have externalId set but no alias yet.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/backfill-product-aliases.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { ListingModel } from '../src/listing/schemas/listing.schema';
import { ProductAliasModel } from '../src/product/schemas/product-alias.schema';

async function bootstrap() {
    const logger = new Logger('BackfillProductAliases');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

    try {
        const listingModel = app.get<Model<ListingModel>>(getModelToken(ListingModel.name));
        const productAliasModel = app.get<Model<ProductAliasModel>>(getModelToken(ProductAliasModel.name));

        const BATCH_SIZE = 200;
        let skip = 0;
        let created = 0;
        let skipped = 0;
        let errors = 0;

        logger.log('Starting ProductAlias backfill from Listings...');

        while (true) {
            const listings = await listingModel
                .find({ externalId: { $exists: true, $ne: null, $type: 'string' }, productId: { $exists: true, $ne: null } })
                .select('_id productId marketplaceId externalId title')
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean()
                .exec();

            if (listings.length === 0) break;

            for (const listing of listings) {
                try {
                    const result = await productAliasModel.findOneAndUpdate(
                        { marketplaceId: listing.marketplaceId, externalId: listing.externalId },
                        {
                            $setOnInsert: {
                                product: listing.productId,
                                sku: listing.externalId,
                                source: 'backfill',
                                confidence: 1,
                            },
                        },
                        { upsert: true, new: false }
                    );

                    if (result === null) {
                        // null from findOneAndUpdate with new:false + upsert = inserted
                        created++;
                        logger.debug(`Created alias: listing=${listing._id} externalId=${listing.externalId}`);
                    } else {
                        skipped++;
                    }
                } catch (err: any) {
                    if (err?.code === 11000) {
                        skipped++; // Already exists
                    } else {
                        errors++;
                        logger.warn(`Error for listing ${listing._id}: ${err.message}`);
                    }
                }
            }

            logger.log(`Progress: skip=${skip} | created=${created} skipped=${skipped} errors=${errors}`);
            skip += BATCH_SIZE;
        }

        logger.log(`Done. Total created=${created} skipped=${skipped} errors=${errors}`);
    } finally {
        await app.close();
    }
}

bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
