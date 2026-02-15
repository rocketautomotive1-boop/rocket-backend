import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mysql from 'mysql2/promise';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { BrandModel, BrandDocument } from '../schemas/brand.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { MarketplaceModel, MarketplaceDocument, MarketplaceDescriptionTemplateSnapshot } from '../../marketplace/schemas/marketplace.schema';

@Injectable()
export class MigrationService {
    private readonly logger = new Logger(MigrationService.name);

    constructor(
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
        @InjectModel(BrandModel.name)
        private readonly brandModel: Model<BrandDocument>,
        @InjectModel(CategoryModel.name)
        private readonly categoryModel: Model<CategoryDocument>,
        @InjectModel(MarketplaceModel.name)
        private readonly marketplaceModel: Model<MarketplaceDocument>,
    ) { }

    async migrateBrands() {
        // ... (existing migrateBrands implementation)
        this.logger.log('Starting Brand Migration...');

        // 1. Find all products with a brand
        const products = await this.productModel.find({ 'brand': { $ne: null } }).select('brand description name').exec();

        this.logger.log(`Found ${products.length} products to analyze for brands.`);

        const stats = { created: 0, updated: 0, skipped: 0, errors: 0, linked: 0 };
        // We still track created/updated, but we process EVERY product to link it

        for (const product of products) {
            if (!product.brand || !product.brand.name) continue;

            const name = product.brand.name;
            let brandDoc: BrandDocument;

            try {
                const existingBrand = await this.brandModel.findOne({
                    $or: [
                        { name: name }
                    ]
                });

                if (existingBrand) {
                    brandDoc = existingBrand;

                    // Update missing info in Brand Doc from Product Snapshot
                    let needsUpdate = false;

                    // Only update if existing is null/empty and product has value
                    if (!brandDoc.fullName && product.brand.fullName) { brandDoc.fullName = product.brand.fullName; needsUpdate = true; }
                    if (!brandDoc.shortName && product.brand.shortName) { brandDoc.shortName = product.brand.shortName; needsUpdate = true; }
                    if (!brandDoc.amazonName && product.brand.amazonName) { brandDoc.amazonName = product.brand.amazonName; needsUpdate = true; }

                    if (needsUpdate) {
                        await brandDoc.save();
                        stats.updated++;
                    } else {
                        stats.skipped++;
                    }

                } else {
                    // Create new
                    brandDoc = await this.brandModel.create({
                        name: product.brand.name,
                        logoUrl: product.brand.logoUrl,
                        isGenuine: product.brand.isGenuine,
                        shortName: product.brand.shortName,
                        amazonName: product.brand.amazonName,
                        fullName: product.brand.fullName,
                        description: product.description ? `Brand extracted from ${product.name}` : undefined,
                        active: true
                    });
                    stats.created++;
                }

                // LINK PRODUCT TO BRAND (Update Snapshot)
                if (brandDoc) {
                    // Force update the embedded snapshot to have the correct MongoDB _id
                    await this.productModel.updateOne(
                        { _id: product._id },
                        {
                            $set: {
                                'brand._id': brandDoc._id.toString()
                            }
                        }
                    );
                    stats.linked++;
                }

            } catch (err) {
                this.logger.error(`Failed to migrate brand ${name} for product ${product._id}:`, err);
                stats.errors++;
            }
        }

        this.logger.log('Brand Migration Completed', stats);
        return stats;
    }

    async migrateCategories() {
        this.logger.log('Starting Category Migration...');

        // Select necessary fields
        const products = await this.productModel.find({ 'category': { $ne: null } }).select('category').exec();
        this.logger.log(`Found ${products.length} products to analyze for categories.`);

        const stats = { created: 0, updated: 0, skipped: 0, errors: 0, linked: 0 };

        for (const productDoc of products) {
            const product = productDoc as any;
            if (!product.category || !product.category.name) continue;

            const name = product.category.name;
            let categoryDoc: CategoryDocument;

            try {
                const existingCategory = await this.categoryModel.findOne({
                    $or: [
                        { name: name }
                    ]
                });

                if (existingCategory) {
                    categoryDoc = existingCategory;
                    let needsUpdate = false;
                    if (needsUpdate) {
                        await categoryDoc.save();
                        stats.updated++;
                    } else {
                        stats.skipped++;
                    }

                } else {
                    categoryDoc = await this.categoryModel.create({
                        name: name,
                        slug: name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '') + '-' + Math.random().toString(36).substr(2, 5), // Ensure uniqueness or use helper
                        ancestors: [],
                        active: true
                    });
                    stats.created++;
                }

                // LINK PRODUCT TO CATEGORY
                if (categoryDoc) {
                    await this.productModel.updateOne(
                        { _id: product._id },
                        {
                            $set: {
                                'category._id': categoryDoc._id.toString()
                            }
                        }
                    );
                    stats.linked++;
                }

            } catch (err) {
                this.logger.error(`Failed to migrate category ${name} for product ${product._id}:`, err);
                stats.errors++;
            }
        }

        this.logger.log('Category Migration Completed', stats);
        return stats;
    }

    async migrateDescriptionTemplates() {
        this.logger.log('Starting Description Template Migration from MySQL...');

        let connection;

        try {
            // 1. Establish MySQL Connection
            connection = await mysql.createConnection({
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT) || 3306,
                user: process.env.DB_USERNAME || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_DATABASE || 'marketplace_integration',
            });

            this.logger.log('Connected to MySQL. Fetching templates...');

            // 2. Fetch templates from legacy table
            const [rows] = await connection.execute('SELECT * FROM marketplace_description_templates');
            const legacyTemplates = rows as any[];

            this.logger.log(`Found ${legacyTemplates.length} templates in MySQL.`);

            let stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

            // 3. Migrate each template
            for (const item of legacyTemplates) {
                try {
                    // Find Marketplace ID by Name (assuming name matches or using legacy mapping if needed)
                    // The legacy table might have 'marketplaceId'. 
                    // We need to map this legacy numeric ID to our new MongoDB Marketplace Document.

                    // First, try to find marketplace by legacy ID if we have it on our Mongo Marketplace records
                    // If not, try by name if possible (but we might not have name in the template table, only id)

                    // Let's assume we need to fetch the marketplace name from MySQL too OR we rely on mapped 'legacyId' in Mongo Marketplace.
                    // Let's assume our Mongo Marketplaces have 'legacyId'.

                    const legacyMarketplaceId = item.marketplaceId;
                    const mongoMarketplace = await this.marketplaceModel.findOne({ legacyId: legacyMarketplaceId });

                    if (!mongoMarketplace) {
                        this.logger.warn(`Marketplace with legacy ID ${legacyMarketplaceId} not found in MongoDB. Skipping template ${item.name}.`);
                        stats.errors++;
                        continue;
                    }

                    // Check if exists in embedded templates
                    const existing = mongoMarketplace.templates?.find(t => t.name === item.name);

                    if (existing) {
                        stats.skipped++;
                        continue;
                    }

                    // Safely parse JSON fields
                    let placeholders = {};
                    if (item.placeholders) {
                        placeholders = typeof item.placeholders === 'string'
                            ? JSON.parse(item.placeholders)
                            : item.placeholders;
                    }

                    let sections = [];
                    if (item.sections) {
                        sections = typeof item.sections === 'string'
                            ? JSON.parse(item.sections)
                            : item.sections;
                    }

                    // Create new snapshot
                    const newTemplate: MarketplaceDescriptionTemplateSnapshot = {
                        name: item.name,
                        title: item.title,
                        template: item.template,
                        isActive: item.isActive === 1 || item.isActive === true,
                        isDefault: item.isDefault === 1 || item.isDefault === true,
                        placeholders,
                        sections
                    };

                    if (!mongoMarketplace.templates) mongoMarketplace.templates = [];
                    mongoMarketplace.templates.push(newTemplate);
                    await mongoMarketplace.save();

                    stats.created++;

                } catch (innerErr) {
                    this.logger.error(`Error migrating template ${item.id}: ${innerErr.message}`);
                    stats.errors++;
                }
            }

            this.logger.log('Description Template Migration Completed', stats);
            return { success: true, stats };

        } catch (error) {
            this.logger.error('Failed to migrate description templates from MySQL:', error);
            return { success: false, error: error.message };
        } finally {
            if (connection) await connection.end();
        }
    }
}
