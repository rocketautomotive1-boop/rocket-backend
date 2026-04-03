/**
 * Remove the legacy numeric `sku` field from all product documents.
 *
 * Products now use `_id` (MongoDB ObjectId) as the universal identifier.
 * This script also migrates the `productCompatibilities` collection, which
 * stored the numeric SKU as `productId` — replacing it with the string form
 * of the product's ObjectId.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/remove-product-sku.ts
 *
 * Options (env vars):
 *   DRY_RUN=true  — log what would change without writing
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { ProductModel } from '../src/product/schemas/product.schema';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function bootstrap() {
    const logger = new Logger('RemoveProductSku');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

    try {
        const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));
        const db = productModel.db;

        // ─── Step 1: Products ──────────────────────────────────────────────────
        // Use raw collection to bypass Mongoose strict mode (sku removed from schema)
        const productsCollection = productModel.collection;
        const withSku = await productsCollection.countDocuments({ sku: { $exists: true } });
        logger.log(`Products with sku field: ${withSku}`);

        if (!DRY_RUN && withSku > 0) {
            const result = await productsCollection.updateMany(
                { sku: { $exists: true } },
                { $unset: { sku: '' } }
            );
            logger.log(`Products updated (sku removed): ${result.modifiedCount}`);
        }

        // ─── Step 2: ProductCompatibilities ───────────────────────────────────
        // Old records store numeric SKU as productId string.
        // Re-resolve using the `product` (ObjectId ref) already on the document.
        const compatCollection = db.collection('productcompatibilities');
        const compatTotal = await compatCollection.countDocuments({});
        logger.log(`ProductCompatibilities total: ${compatTotal}`);

        // Find compatibilities where productId is NOT a valid ObjectId (i.e., numeric legacy)
        const legacyCompats = await compatCollection
            .find({ product: { $exists: true, $ne: null } })
            .project({ _id: 1, product: 1, productId: 1 })
            .toArray();

        const needsMigration = legacyCompats.filter(c => {
            const pid = String(c.productId || '');
            return pid && !/^[a-f\d]{24}$/i.test(pid); // Not a valid ObjectId
        });

        logger.log(`Compatibilities with legacy numeric productId: ${needsMigration.length}`);

        if (!DRY_RUN && needsMigration.length > 0) {
            let updated = 0;
            for (const compat of needsMigration) {
                await compatCollection.updateOne(
                    { _id: compat._id },
                    { $set: { productId: String(compat.product) } }
                );
                updated++;
            }
            logger.log(`Compatibilities migrated (productId → ObjectId string): ${updated}`);
        }

        // ─── Verify ───────────────────────────────────────────────────────────
        if (!DRY_RUN) {
            const remaining = await productsCollection.countDocuments({ sku: { $exists: true } });
            logger.log(`Verification — products still with sku: ${remaining}`);
        }

        logger.log(DRY_RUN
            ? '[DRY RUN] No changes written. Re-run without DRY_RUN=true to apply.'
            : 'Migration complete.'
        );
    } finally {
        await app.close();
    }
}

bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
