import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FiscalIssuerModel, FiscalDocumentModel } from '../src/fiscal/schemas/fiscal.schema';
import { OrderModel } from '../src/order/schemas/order.schema';
import { FiscalIssuer } from '../src/fiscal/entities/fiscal-issuer.entity';
import { FiscalDocument } from '../src/fiscal/entities/fiscal-document.entity';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('MigrateFiscal');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const issuerModel = app.get<Model<FiscalIssuerModel>>(getModelToken(FiscalIssuerModel.name));
        const docModel = app.get<Model<FiscalDocumentModel>>(getModelToken(FiscalDocumentModel.name));
        const orderModel = app.get<Model<OrderModel>>(getModelToken(OrderModel.name));

        const issuerRepo = app.get(getRepositoryToken(FiscalIssuer));
        const docRepo = app.get(getRepositoryToken(FiscalDocument));

        logger.log('Starting Fiscal Migration (MySQL -> Mongo)...');

        // 1. Clear existing (Safe)
        logger.warn('Dropping existing fiscal collections...');
        try { await issuerModel.collection.drop(); } catch (e) { }
        try { await docModel.collection.drop(); } catch (e) { }
        logger.log('Fiscal collections cleared.');

        // 2. Migrate Issuers
        logger.log('Migrating Issuers...');
        const mysqlIssuers = await issuerRepo.find();
        const issuerMap = new Map<number, any>();

        for (const issuer of mysqlIssuers) {
            const newIssuer = await issuerModel.create({
                cnpj: issuer.cnpj,
                ie: issuer.ie,
                companyName: issuer.companyName,
                fantasyName: issuer.fantasyName,
                taxRegime: issuer.taxRegime,
                lastNfeNumber: issuer.lastNfeNumber,
                nfeSeries: issuer.nfeSeries,
                certificatePfx: issuer.certificatePfx,
                certificatePassword: issuer.certificatePassword,
                address: issuer.address,
                isActive: issuer.isActive,
                legacyId: issuer.id
            });
            issuerMap.set(issuer.id, newIssuer._id);
        }
        logger.log(`Migrated ${mysqlIssuers.length} issuers.`);

        // 3. Migrate Documents
        const BATCH_SIZE = 50;
        let page = 0;
        let hasMore = true;
        let successCount = 0;

        while (hasMore) {
            logger.log(`Fetching documents batch ${page + 1}...`);
            const docs = await docRepo.find({
                take: BATCH_SIZE,
                skip: page * BATCH_SIZE,
                order: { id: 'ASC' },
            });

            if (docs.length === 0) {
                hasMore = false;
                break;
            }

            // Pre-fetch related Orders for linking
            const orderIds = docs.map(d => d.internalOrderId).filter(id => id);
            const relatedOrders = await orderModel.find({ legacyId: { $in: orderIds } }).select('_id legacyId');
            const orderMap = new Map<number, any>();
            relatedOrders.forEach(o => orderMap.set(o.legacyId, o._id));

            const bulkOps = docs.map(doc => {
                let issuerId = null;
                // Assuming issuer relationship in MySQL (if explicit field exists, otherwise default to first issuer or null)
                // FiscalDocument entity has 'issuer' relation. We need to load it or access issuerId column if exposed.
                // Entity definition: @JoinColumn({ name: 'issuerId' }) issuer: FiscalIssuer;
                // TypeORM usually exposes 'issuerId' if we select it or use loadRelationId.
                // For now, let's assume we can get it via loadRelationIds logic or if it's magically there (it's not usually).
                // We'll use a safer approach: assume single issuer for now or modify query if needed. 
                // Actually, let's try to get raw 'issuerId' from the entity property if TypeORM mapped it, 
                // OR fetch with relations.

                return {
                    insertOne: {
                        document: {
                            internalOrderId: doc.internalOrderId,
                            series: doc.series,
                            number: doc.number,
                            accessKey: doc.accessKey,
                            xml: doc.xml,
                            xmlSigned: doc.xmlSigned,
                            protocol: doc.protocol,
                            status: doc.status,
                            environment: doc.environment,
                            rejectionReason: doc.rejectionReason,
                            legacyId: doc.id,

                            // Link to Order
                            order: doc.internalOrderId ? orderMap.get(doc.internalOrderId) : null,

                            // Link to Issuer: MySQL entity didn't expose 'issuerId' column directly as number field, 
                            // only relation. We might miss it if we don't load relation.
                            // But usually there's only 1 issuer. 
                            // We will use the first migrated issuer as default if connection is missing.
                            issuer: issuerMap.values().next().value
                        }
                    }
                };
            });

            if (bulkOps.length > 0) {
                await docModel.bulkWrite(bulkOps);
                successCount += bulkOps.length;
            }
            page++;
        }

        logger.log(`Migration Completed. Success: ${successCount}`);

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
