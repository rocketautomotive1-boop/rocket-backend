import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestionModel } from '../src/questions/schemas/question.schema';
import { ProductModel } from '../src/product/schemas/product.schema';
import { MarketplaceQuestion } from '../src/questions/entities/marketplace-question.entity';
import { MarketplaceModel } from '../src/marketplace/schemas/marketplace.schema';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('MigrateQuestions');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const questionModel = app.get<Model<QuestionModel>>(getModelToken(QuestionModel.name));
        const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));
        const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));
        const questionRepo = app.get(getRepositoryToken(MarketplaceQuestion));

        const BATCH_SIZE = 50;
        let page = 0;
        let hasMore = true;
        let successCount = 0;
        let warningCount = 0;

        logger.log('Starting Questions Migration (MySQL -> Mongo)...');

        // 1. Clear existing questions (Safe)
        logger.warn('Dropping existing questions...');
        try { await questionModel.collection.drop(); } catch (e) { }
        logger.log('Questions cleared.');

        // 2. Pre-fetch Product Map (MySQL ID -> Mongo _id)
        logger.log('Building Product Map...');
        const products = await productModel.find({}, { _id: 1, sku: 1 }).exec();
        const productMap = new Map<number, any>();
        products.forEach(p => {
            // sku holds the legacy MySQL ID
            if (p.sku) productMap.set(Number(p.sku), p._id);
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
            const questions = await questionRepo.find({
                take: BATCH_SIZE,
                skip: page * BATCH_SIZE,
                order: { id: 'ASC' },
            });

            if (questions.length === 0) {
                hasMore = false;
                break;
            }

            const bulkOps = [];

            for (const q of questions) {
                const linkedProduct = q.productId ? productMap.get(q.productId) : null;

                if (!linkedProduct) {
                    // warn but maybe insert anyway? 
                    // The schema says product is just an ObjectId, not required? 
                    // Wait, in schema: @Prop({ type: Types.ObjectId, ref: 'ProductModel', index: true }) product: Types.ObjectId;
                    // It is not marked required: true. But usually questions need a product.
                    // We will insert anyway.
                    // warningCount++;
                }

                bulkOps.push({
                    insertOne: {
                        document: {
                            externalId: q.externalId,
                            itemId: q.itemId,
                            question: q.question || '(Empty Question)', // Fallback for missing content
                            answer: q.answer,
                            status: q.status || 'UNANSWERED',
                            buyerId: q.buyerId,
                            dateCreated: q.dateCreated,
                            dateAnswered: q.dateAnswered,
                            product: linkedProduct,
                            marketplaceId: (q.marketplaceId ? marketplaceMap.get(q.marketplaceId) : null) as any,
                            legacyId: q.id
                        }
                    }
                });
            }

            if (bulkOps.length > 0) {
                try {
                    const res = await questionModel.bulkWrite(bulkOps, { ordered: false });

                    if (res.hasWriteErrors()) {
                        logger.error(`BulkWrite Errors: ${res.getWriteErrors().length} errors.`);
                        logger.error(`First Error: ${JSON.stringify(res.getWriteErrors()[0])}`);
                    }

                    successCount += res.insertedCount;
                    logger.log(`Batch ${page + 1}: Input ${bulkOps.length}, Actual Inserted ${res.insertedCount}, Modified ${res.modifiedCount}`);

                    // DEBUG: Verify count immediately
                    const count = await questionModel.countDocuments();
                    logger.log(`DEBUG: Current Total Questions in DB: ${count}`);

                } catch (e: any) {
                    // If ordered: false, some might succeed.
                    // The error object in bulkWrite (Mongoose) is complex.
                    // For now, assume partial success or log error.
                    if (e.writeErrors) {
                        logger.warn(`Batch ${page + 1}: ${e.writeErrors.length} errors, ${e.nInserted} inserted.`);
                        successCount += e.nInserted;
                        warningCount += e.writeErrors.length;
                    } else {
                        logger.error(`Batch insert failed: ${e.message}`);
                        warningCount += bulkOps.length;
                    }
                }
            }
            page++;
        }

        logger.log(`Migration Completed. Success: ${successCount}, Warnings: ${warningCount}`);

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
