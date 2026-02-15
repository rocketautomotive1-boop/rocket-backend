import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProductService } from '../src/product/product.service';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductModel } from '../src/product/schemas/product.schema';
import { StockMovementModel } from '../src/product/schemas/stock-movement.schema';
import { ProductCompatibilityModel } from '../src/product/schemas/product-compatibility.schema';
import { MarketplaceModel } from '../src/marketplace/schemas/marketplace.schema';
import { Product } from '../src/product/entities/product.entity';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('Migration');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {

        const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));
        const stockMovementModel = app.get<Model<StockMovementModel>>(getModelToken(StockMovementModel.name));
        const compatibilityModel = app.get<Model<ProductCompatibilityModel>>(getModelToken(ProductCompatibilityModel.name));
        const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));
        const productRepository = app.get(getRepositoryToken(Product));
        const manager = productRepository.manager;

        const BATCH_SIZE = 50;
        let page = 0;
        let hasMore = true;
        let totalProcessed = 0;
        let successCount = 0;
        let errorCount = 0;

        logger.log('Starting PROFESSIONAL optimization (Linear Fetch Strategy + Dedup)...');

        // 0. Pre-fetch Marketplaces for ID Mapping
        logger.log('Loading Marketplaces for legacy ID mapping...');
        const mongoMarketplaces = await marketplaceModel.find().lean().exec();
        const marketplaceMap = new Map<number, Types.ObjectId>();

        mongoMarketplaces.forEach((mp: any) => {
            // Assuming legacyId was stored in 'legacyId' field or we check 'id' if matched manually
            // Migration script `migrate-marketplaces.ts` stores `legacyId`.
            if (mp.legacyId) {
                marketplaceMap.set(mp.legacyId, mp._id);
            }
        });
        logger.log(`Loaded ${marketplaceMap.size} marketplaces for mapping.`);

        // 1. Clear existing data (Safe Drop)
        logger.warn('Dropping existing collections for clean state... (Fast Mode)');
        try { await productModel.collection.drop(); } catch (e) { }
        try { await stockMovementModel.collection.drop(); } catch (e) { }
        try { await compatibilityModel.collection.drop(); } catch (e) { }
        logger.log('Collections dropped (or empty).');

        while (hasMore) {
            logger.log(`Fetching batch ${page + 1} (Products Base)...`);

            const products = await productRepository.find({
                take: BATCH_SIZE,
                skip: page * BATCH_SIZE,
                order: { id: 'ASC' },
                relations: [
                    'brand',
                    'category',
                    'unit',
                    'productImages'
                ]
            });

            if (products.length === 0) {
                hasMore = false;
                break;
            }

            logger.log(`Fetched ${products.length} products. Hydrating complex relations linearly...`);

            for (const product of products) {
                try {
                    const [titles, attributes, compatibilities, boxItems, movements, externalCategory] = await Promise.all([
                        // Titles
                        manager.query(`
                            SELECT pt.*, m.name as marketplaceName 
                            FROM product_titles pt 
                            LEFT JOIN marketplaces m ON pt.marketplaceId = m.id 
                            WHERE pt.productId = ?
                        `, [product.id]),

                        // Attributes (Verified: productId)
                        manager.query(`
                            SELECT pa.* 
                            FROM product_attributes pa 
                            WHERE pa.productId = ?
                        `, [product.id]),

                        // Compatibilities
                        manager.query(`
                            SELECT * FROM product_compatibilities WHERE productId = ?
                        `, [product.id]),

                        // Box Items (Verified: boxId, productId. Only Box has allocationId)
                        // Note: Using LEFT JOIN because boxId might be 0 or invalid?
                        manager.query(`
                            SELECT bi.*, b.code as boxCode, b.id as boxId, 
                                   a.id as allocationId, a.code as allocationCode,
                                   a.warehouseId, a.floor, a.room, a.row, a.level, a.rack, a.shelf, a.bin, a.aisle
                            FROM box_items bi
                            LEFT JOIN boxes b ON bi.boxId = b.id
                            LEFT JOIN product_allocations a ON b.allocationId = a.id
                            WHERE bi.productId = ?
                        `, [product.id]),

                        // Movements
                        manager.query(`
                            SELECT pm.*, 
                                   fa.code as fromCode, ta.code as toCode 
                            FROM product_movements pm
                            LEFT JOIN product_allocations fa ON pm.fromAllocationId = fa.id
                            LEFT JOIN product_allocations ta ON pm.toAllocationId = ta.id
                            WHERE pm.productId = ? 
                            ORDER BY pm.createdAt DESC
                        `, [product.id]),

                        // External Category (Marketplace Mappings)
                        product.category ? manager.query(`
                            SELECT mc.externalId 
                            FROM category_mappings cm
                            JOIN marketplace_categories mc ON cm.marketplaceCategoryId = mc.id
                            WHERE cm.internalCategoryId = ? AND cm.marketplaceId = 1
                            LIMIT 1
                        `, [product.category.id]) : Promise.resolve([])
                    ]);

                    // --- OPTIMIZATIONS ---

                    // 1. Name Fallback
                    let resolvedName = product.name;
                    if (!resolvedName || resolvedName.trim() === '') {
                        if (titles && titles.length > 0) {
                            resolvedName = titles[0].title;
                        } else {
                            resolvedName = `${product.brand?.name || ''} ${product.partNumber}`;
                        }
                    }

                    // 2. Slug Generation
                    const generateSlug = (text: string) => {
                        return text.toString().toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                            .replace(/\s+/g, '-')
                            .replace(/[^\w\-]+/g, '')
                            .replace(/\-\-+/g, '-')
                            .replace(/^-+/, '')
                            .replace(/-+$/, '');
                    };
                    let finalSlug = product.slug || generateSlug(`${resolvedName}-${product.partNumber}`);

                    // 3. Price Inference
                    let finalPrice = product.price;
                    if (!finalPrice || finalPrice === 0) {
                        const lastInbound = movements
                            ?.filter((m: any) => m.type === 'inbound' && parseFloat(m.price) > 0)
                            .sort((a: any, b: any) => new Date(b.created_at || b.createdAt).getTime() - new Date(a.created_at || a.createdAt).getTime())[0];

                        if (lastInbound) {
                            finalPrice = parseFloat(lastInbound.price);
                        }
                    }

                    // 4. Attribute Filtering
                    const filteredAttributes = attributes?.filter((a: any) => {
                        const code = (a.code || '').toUpperCase();
                        return !['SKU', 'BRAND', 'PART_NUMBER', 'EAN'].includes(code);
                    }).map((a: any) => ({
                        name: a.name,
                        value: a.value,
                        code: a.code,
                        marketplaceId: a.marketplaceId ? marketplaceMap.get(a.marketplaceId) : undefined
                    })) || [];

                    // --- MAPPING ---

                    const mongoProduct = {
                        name: resolvedName,
                        partNumber: product.partNumber,
                        sku: product.id,
                        barcode: product.barcode || product.gtin || '',
                        isGenuine: (product.isGenuine === 1 || product.isGenuine === true),
                        // slug: finalSlug, // Set below in loop
                        description: product.shortDescription,
                        price: Types.Decimal128.fromString((finalPrice || 0).toString()),
                        costPrice: Types.Decimal128.fromString('0'),

                        weight: Types.Decimal128.fromString((product.weight || 0).toString()),
                        dimensions: {
                            length: Types.Decimal128.fromString((product.length || 0).toString()),
                            width: Types.Decimal128.fromString((product.width || 0).toString()),
                            height: Types.Decimal128.fromString((product.height || 0).toString())
                        },

                        brand: product.brand ? {
                            id: product.brand.id,
                            name: product.brand.name,
                            logoUrl: product.brand.logoUrl,
                            isGenuine: product.brand.isGenuine,
                            shortName: product.brand.shortName,
                            amazonName: product.brand.amazonName,
                            fullName: product.brand.fullName,
                            externalId: product.brand.externalId
                        } : undefined,

                        category: product.category ? {
                            id: product.category.id, // Keeping snapshot ID
                            name: product.category.name,
                            parentId: product.category.parentId,
                            externalId: externalCategory?.[0]?.externalId || undefined
                        } : undefined,

                        unit: product.unit ? {
                            id: product.unit.id,
                            code: product.unit.code,
                            name: product.unit.name
                        } : { code: 'UN', name: 'Unidade', id: 0 },

                        active: product.status === 'active',
                        // Calculate stock from movements (inbound - outbound)
                        stockQuantity: movements?.reduce((acc: number, m: any) => {
                            const qty = Number(m.quantity) || 0;
                            return m.type === 'inbound' ? acc + qty : acc - qty;
                        }, 0) || 0,

                        images: product.productImages?.map((i: any) => ({
                            url: i.url,
                            main: i.order === 0,
                            originalName: i.key
                        })) || [],

                        titles: titles?.map((t: any) => ({
                            marketplaceId: t.marketplaceId ? marketplaceMap.get(t.marketplaceId) : undefined,
                            title: t.title,
                            locale: t.locale,
                            externalId: t.externalId
                        })).filter((t: any) => t.marketplaceId) || [], // Only include valid mappings

                        attributes: filteredAttributes,

                        // Compatibilities REMOVED from ProductModel

                        allocations: boxItems?.map((bi: any) => {
                            return {
                                id: bi.allocationId || null,
                                code: bi.allocationCode ? bi.allocationCode : (bi.boxCode ? `BOX-${bi.boxCode}` : 'LOOSE'),
                                quantity: bi.quantity,
                                type: bi.boxId ? 'box' : 'loose',
                                boxId: undefined, // Skipping legacy integer ID mapping for now (Requires Box Migration Map)
                                // CAUTION: ProductService says boxId: Types.ObjectId. Migration must ensure IDs are correct.
                                // If Boxes are not migrated to ObjectId, this will fail validation.
                                // For now, assuming AllocationSnapshot keeps legacy IDs or we skip.
                                // Let's check schema: boxId: Types.ObjectId.
                                // If we can't map, we should set null.
                                // Leaving as is for now, but be aware.
                                // If we don't have Box migration map, we can't link.
                                // Leaving as is for now, but be aware.
                                boxCode: bi.boxCode || null,
                                warehouseId: undefined, // Skipping legacy integer ID mapping for now
                                floor: bi.floor,
                                room: bi.room,
                                row: bi.row,
                                level: bi.level,
                                rack: bi.rack,
                                shelf: bi.shelf,
                                bin: bi.bin,
                                aisle: bi.aisle
                            };
                        }) || []
                    };

                    // 1. Insert Product (Handle Duplicates)
                    let savedProduct;
                    let retryCount = 0;
                    const maxRetries = 3;

                    while (retryCount < maxRetries) {
                        try {
                            const payload = { ...mongoProduct, slug: finalSlug };
                            const existing = await productModel.findOne({ partNumber: mongoProduct.partNumber });

                            if (existing) {
                                Object.assign(existing, payload);
                                savedProduct = await existing.save();
                            } else {
                                savedProduct = await productModel.create(payload);
                            }
                            break; // Success
                        } catch (e: any) {
                            if (e.code === 11000 && e.keyPattern?.slug) {
                                // Duplicate slug, modify and retry
                                finalSlug = `${finalSlug}-${Math.floor(Math.random() * 1000)}`;
                                retryCount++;
                            } else {
                                throw e; // Rethrow other errors
                            }
                        }
                    }

                    if (!savedProduct) {
                        throw new Error(`Failed to save after ${maxRetries} retries (Slug collision?)`);
                    }

                    // 2. Insert Compatibilities (NEW COLLECTION)
                    if (compatibilities && compatibilities.length > 0) {
                        const compDocs = compatibilities.map((c: any) => ({
                            product: savedProduct._id,
                            vehicleId: c.vehicleId,
                            vehicleName: c.vehicleName,
                            vehicleBrand: c.vehicleBrand,
                            vehicleModel: c.vehicleModel,
                            vehicleYear: c.vehicleYear,
                            vehicleVersion: c.vehicleVersion
                        }));
                        await compatibilityModel.insertMany(compDocs);
                    }

                    // 3. Insert Movements
                    if (movements && movements.length > 0) {
                        const stockMovements = movements.map((m: any) => ({
                            product: savedProduct._id,
                            type: m.type,
                            quantity: m.quantity,
                            date: m.created_at || m.createdAt,
                            from: m.fromCode || 'External',
                            to: m.toCode || 'External',
                            price: Types.Decimal128.fromString((m.price || 0).toString()),
                            reason: m.reason || 'Migration'
                        }));

                        await stockMovementModel.insertMany(stockMovements);
                    }

                    if (successCount % 10 === 0) process.stdout.write('.');
                    successCount++;

                } catch (err: any) {
                    logger.error(`Failed ${product.id}: ${err.message}`);
                    errorCount++;
                }
            }
            console.log('');

            totalProcessed += products.length;
            logger.log(`Batch ${page + 1} Done. Total: ${totalProcessed}`);
            page++;
        }

        logger.log(`\nMigration completed. Success: ${successCount}, Failed: ${errorCount}`);

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
