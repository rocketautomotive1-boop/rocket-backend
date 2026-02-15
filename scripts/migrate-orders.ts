import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderModel } from '../src/order/schemas/order.schema';
import { ProductModel } from '../src/product/schemas/product.schema';
import { Order } from '../src/order/entities/order.entity';
import { OrderItem } from '../src/order/entities/order-item.entity';
import { OrderLog } from '../src/order/entities/order-log.entity';
import { MarketplaceModel } from '../src/marketplace/schemas/marketplace.schema';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { Product } from '../src/product/entities/product.entity';

async function bootstrap() {
    const logger = new Logger('MigrateOrders');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const orderModel = app.get<Model<OrderModel>>(getModelToken(OrderModel.name));
        const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));
        const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));
        const orderRepository = app.get(getRepositoryToken(Order));

        const BATCH_SIZE = 50;
        let page = 0;
        let hasMore = true;
        let successCount = 0;
        let errorCount = 0;

        logger.log('Starting Order Migration (MySQL -> Mongo)...');

        // 1. Clear existing orders (optional, safe for re-running)
        logger.warn('Dropping existing orders...');
        try { await orderModel.collection.drop(); } catch (e) { }
        logger.log('Orders cleared.');

        // 2. Pre-fetch Product Map (MySQL ID -> Mongo _id) for linking
        logger.log('Building Product Map...');
        const products = await productModel.find({}, { _id: 1, sku: 1 }).exec();
        const productMap = new Map<number, any>();
        products.forEach(p => {
            if (p.sku) productMap.set(p.sku, p._id);
        });
        logger.log(`Mapped ${products.length} products for linking.`);

        // 3. Pre-fetch Marketplace Map (Legacy ID -> Mongo ObjectId)
        logger.log('Loading Marketplaces for legacy ID mapping...');
        const mongoMarketplaces = await marketplaceModel.find().lean().exec();
        const marketplaceMap = new Map<number, Types.ObjectId>();
        mongoMarketplaces.forEach((mp: any) => {
            if (mp.legacyId) marketplaceMap.set(mp.legacyId, mp._id);
        });
        logger.log(`Mapped ${marketplaceMap.size} marketplaces.`);

        while (hasMore) {
            logger.log(`Fetching batch ${page + 1}...`);

            // Fetch Orders with Items and Logs
            const orders = await orderRepository.find({
                take: BATCH_SIZE,
                skip: page * BATCH_SIZE,
                order: { id: 'ASC' },
                relations: ['items', 'logs']
            });

            if (orders.length === 0) {
                hasMore = false;
                break;
            }

            const bulkOps = [];

            for (const order of orders) {
                try {
                    // Map Items
                    const items = order.items?.map(item => ({
                        sku: item.sku,
                        title: item.title,
                        quantity: Number(item.quantity),
                        unitPrice: Number(item.unitPrice),
                        productId: item.productId,
                        product: item.productId ? productMap.get(item.productId) : null
                    })) || [];

                    // Map Logs
                    const logs = order.logs?.map(log => ({
                        logType: log.type,
                        message: log.message,
                        details: log.details,
                        createdAt: log.createdAt
                    })) || [];

                    const mongoOrder = {
                        externalId: order.externalId,
                        marketplaceId: (order.marketplaceId ? marketplaceMap.get(order.marketplaceId) : null) as any,
                        status: order.status,
                        totalAmount: Number(order.totalAmount),
                        shippingAmount: Number(order.shippingAmount),
                        trackingCode: order.trackingCode,
                        legacyId: order.id,
                        syncedAt: order.syncedAt,
                        createdAt: order.createdAt,
                        updatedAt: order.updatedAt,

                        customer: {
                            name: order.buyerName,
                            document: order.buyerDocument,
                            email: order.buyerEmail,
                            phone: null, // Not in Order entity explicitly
                            address: {
                                zipCode: order.buyerZipCode,
                                street: order.buyerStreet,
                                number: order.buyerNumber,
                                neighborhood: order.buyerNeighborhood,
                                city: order.buyerCity,
                                state: order.buyerState
                            }
                        },

                        payment: {
                            methodId: order.paymentMethodId,
                            paymentType: order.paymentType,
                            authorizationCode: order.authorizationCode
                        },

                        items: items,
                        logs: logs
                    };

                    bulkOps.push({
                        insertOne: {
                            document: mongoOrder
                        }
                    });

                } catch (err: any) {
                    logger.error(`Failed to map Order ${order.id}: ${err.message}`);
                    errorCount++;
                }
            }

            if (bulkOps.length > 0) {
                await orderModel.bulkWrite(bulkOps);
                successCount += bulkOps.length;
                logger.log(`Batch ${page + 1}: Inserted ${bulkOps.length} orders.`);
            }

            page++;
        }

        logger.log(`Migration Completed. Success: ${successCount}, Failed: ${errorCount}`);

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
