import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MarketplaceModel, MarketplaceSchema } from '../src/marketplace/schemas/marketplace.schema';
import { Model } from 'mongoose';
import { DataSource } from 'typeorm';

// --- Define Lightweight Module with RAW SQL capability ---
@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // MySQL Connection - NO ENTITIES (Raw Mode)
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'mysql',
                host: configService.get('DB_HOST', 'localhost'),
                port: configService.get('DB_PORT', 3306),
                username: configService.get('DB_USERNAME', 'root'),
                password: configService.get('DB_PASSWORD', ''),
                database: configService.get('DB_DATABASE', 'marketplace_integration'),
                entities: [], 
                autoLoadEntities: false,
                synchronize: false,
                timezone: 'Z',
            }),
        }),
        // Mongo Connection
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                uri: configService.get<string>('MONGO_URI'),
            }),
        }),
        MongooseModule.forFeature([{ name: MarketplaceModel.name, schema: MarketplaceSchema }]),
    ],
})
class MigrationModule {}

async function bootstrap() {
    const logger = new Logger('MigrateMarketplaces');
    const app = await NestFactory.createApplicationContext(MigrationModule, { logger: ['error', 'warn', 'log'] });

    try {
        const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));
        const dataSource = app.get(DataSource);
        
        logger.log('Starting Marketplace Migration (MySQL RAW -> Mongo)...');
        
        // 1. Clear existing (Safe)
        try { await marketplaceModel.collection.drop(); } catch (e) {}
        logger.log('Marketplaces cleared.');

        // 2. Fetch Raw Data
        logger.log('Fetching from MySQL (RAW)...');
        
        const marketplaces = await dataSource.query('SELECT * FROM marketplaces ORDER BY id ASC');
        logger.log(`Found ${marketplaces.length} marketplaces.`);

        const bulkOps = [];

        for (const mp of marketplaces) {
            
            // Link Tokens
            const tokens = await dataSource.query('SELECT * FROM marketplace_tokens WHERE marketplaceId = ?', [mp.id]);
            
            // Link Requirements
            const requirements = await dataSource.query('SELECT * FROM marketplace_requirements WHERE marketplaceId = ?', [mp.id]);

            const mongoMp = {
                name: mp.name,
                appId: mp.appId,
                enabled: Boolean(mp.enabled),
                apiUrl: mp.apiUrl,
                logoUrl: mp.logoUrl,
                description: mp.description,
                settings: mp.settings ? (typeof mp.settings === 'string' ? JSON.parse(mp.settings) : mp.settings) : {},
                legacyId: mp.id,

                tokens: tokens.map((t: any) => ({
                    accessToken: t.accessToken,
                    refreshToken: t.refreshToken,
                    expiresAt: t.expiresAt,
                    tokenType: t.tokenType,
                    additionalData: t.additionalData ? (typeof t.additionalData === 'string' ? JSON.parse(t.additionalData) : t.additionalData) : {},
                    isActive: Boolean(t.isActive)
                })),

                requirements: requirements.map((r: any) => ({
                    fieldName: r.fieldName,
                    displayName: r.displayName,
                    description: r.description,
                    isRequired: Boolean(r.isRequired),
                    dataType: r.dataType,
                    validationRules: r.validationRules ? (typeof r.validationRules === 'string' ? JSON.parse(r.validationRules) : r.validationRules) : {},
                    options: r.options ? (typeof r.options === 'string' ? JSON.parse(r.options) : r.options) : {},
                    displayOrder: r.displayOrder
                }))
            };

            bulkOps.push({ insertOne: { document: mongoMp } });
        }

        if (bulkOps.length > 0) {
            await marketplaceModel.bulkWrite(bulkOps);
            logger.log(`Migration Completed. Success: ${bulkOps.length}`);
        } else {
            logger.warn('No marketplaces found to migrate.');
        }

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
        process.exit(0);
    }
}

bootstrap();
