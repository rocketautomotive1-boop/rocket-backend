/**
 * Re-resolve productId for order items where productId is null.
 * Run AFTER backfill-product-aliases.ts to ensure aliases are populated.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/reconcile-order-products.ts
 *
 * Options (env vars):
 *   DRY_RUN=true        — log what would be updated without writing
 *   MARKETPLACE_ID=xxx  — restrict to a specific marketplace
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { OrderModel } from '../src/order/schemas/order.schema';
import { ListingModel } from '../src/listing/schemas/listing.schema';
import { ProductMatcherService } from '../src/product/services/product-matcher.service';

const DRY_RUN = process.env.DRY_RUN === 'true';
const FILTER_MARKETPLACE = process.env.MARKETPLACE_ID || null;

async function bootstrap() {
    const logger = new Logger('ReconcileOrderProducts');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

    try {
        const orderModel = app.get<Model<OrderModel>>(getModelToken(OrderModel.name));
        const listingModel = app.get<Model<ListingModel>>(getModelToken(ListingModel.name));
        const productMatcher = app.get(ProductMatcherService);

        logger.log(`Starting order product reconciliation${DRY_RUN ? ' [DRY RUN]' : ''}...`);
        if (FILTER_MARKETPLACE) logger.log(`Filtering by marketplaceId: ${FILTER_MARKETPLACE}`);

        const query: any = { 'items.productId': null };
        if (FILTER_MARKETPLACE) query.marketplaceId = new Types.ObjectId(FILTER_MARKETPLACE);

        const BATCH_SIZE = 100;
        let skip = 0;
        let resolvedItems = 0;
        let resolvedByTitle = 0;
        let unresolvedItems = 0;
        let updatedOrders = 0;

        while (true) {
            const orders = await orderModel
                .find(query)
                .select('_id externalId marketplaceId items')
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean()
                .exec();

            if (orders.length === 0) break;

            for (const order of orders) {
                const marketplaceId = order.marketplaceId?.toString();
                const updates: { index: number; productId: Types.ObjectId }[] = [];

                for (let i = 0; i < order.items.length; i++) {
                    const item = order.items[i] as any;
                    if (item.productId) continue;

                    const externalId = item.externalId || '';

                    // Primary: use ProductMatcher (S0 _id direct → ProductAlias → Listing by externalId → Listing by SKU)
                    let productId = await productMatcher.resolveProduct(externalId, '', marketplaceId);

                    // Fallback for legacy orders: title-based listing lookup (best-effort, exact title match)
                    if (!productId && item.title && marketplaceId) {
                        const escaped = item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const listing = await listingModel
                            .findOne({
                                marketplaceId: new Types.ObjectId(marketplaceId),
                                title: { $regex: `^${escaped}$`, $options: 'i' },
                                productId: { $exists: true, $ne: null },
                            })
                            .select('productId title')
                            .lean()
                            .exec();

                        if (listing?.productId) {
                            productId = listing.productId.toString();
                            resolvedByTitle++;
                            logger.log(`Resolved by title: order=${order.externalId} item[${i}] title="${item.title}" → productId=${productId}`);
                        }
                    }

                    if (productId && Types.ObjectId.isValid(productId)) {
                        updates.push({ index: i, productId: new Types.ObjectId(productId) });
                        resolvedItems++;
                        logger.log(`Resolved: order=${order.externalId} item[${i}] externalId=${externalId} → productId=${productId}`);
                    } else {
                        unresolvedItems++;
                        logger.warn(`Unresolved: order=${order.externalId} item[${i}] externalId=${externalId} title="${item.title}"`);
                    }
                }

                if (updates.length > 0 && !DRY_RUN) {
                    const updateOps: any = {};
                    for (const { index, productId } of updates) {
                        updateOps[`items.${index}.productId`] = productId;
                    }
                    await orderModel.updateOne({ _id: order._id }, { $set: updateOps });
                    updatedOrders++;
                }
            }

            logger.log(`Progress: skip=${skip} | resolved=${resolvedItems} (by-title=${resolvedByTitle}) unresolved=${unresolvedItems} orders_updated=${updatedOrders}`);
            skip += BATCH_SIZE;
        }

        logger.log(`Done${DRY_RUN ? ' [DRY RUN — no writes performed]' : ''}.`);
        logger.log(`Summary: resolved=${resolvedItems} (by-title=${resolvedByTitle}) unresolved=${unresolvedItems} orders_updated=${updatedOrders}`);
    } finally {
        await app.close();
    }
}

bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
