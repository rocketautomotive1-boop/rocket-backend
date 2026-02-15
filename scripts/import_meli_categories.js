const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const MONGODB_URI = process.env.MONGO_URI;
const SOURCE_ROOT_ID = 'MLB5672'; // Acessórios para Veículos
const BATCH_SIZE = 100;

// Slugify helper
function slugify(text) {
    return text.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[^a-z0-9]+/g, '-')     // replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '');        // remove leading/trailing hyphens
}

async function connectDB() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
}

async function run() {
    if (process.argv.length < 3) {
        console.error('Usage: node scripts/import_meli_categories.js <path-to-json-dump>');
        process.exit(1);
    }

    const dumpFilePath = process.argv[2];

    try {
        await connectDB();

        // 1. Define Schemas (Simplified for script usage)
        const CategorySchema = new mongoose.Schema({
            name: { type: String, required: true },
            slug: { type: String, required: true }, // Not unique index here to avoid script failure, but app logic requires it
            parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
            ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
            active: { type: Boolean, default: true },
            marketplaceMappings: [{
                marketplaceId: mongoose.Schema.Types.ObjectId,
                externalId: String,
                externalName: String,
                path: String,
                attributeMappings: Object
            }]
        }, { collection: 'categories', timestamps: true });

        const MarketplaceSchema = new mongoose.Schema({
            name: String,
            // other fields...
        }, { collection: 'marketplaces' });

        const CategoryModel = mongoose.model('Category', CategorySchema);
        const MarketplaceModel = mongoose.model('Marketplace', MarketplaceSchema);

        // 2. Find Mercado Livre Marketplace ID
        const marketplace = await MarketplaceModel.findOne({ name: 'Mercado Livre' });
        if (!marketplace) {
            throw new Error('Marketplace "Mercado Livre" not found in database.');
        }
        const marketplaceId = marketplace._id;
        console.log(`Found Mercado Livre Marketplace ID: ${marketplaceId}`);

        // 3. Load and Parse JSON
        console.log(`Reading dump file: ${dumpFilePath}`);
        const rawData = fs.readFileSync(dumpFilePath, 'utf8');
        const categoriesDict = JSON.parse(rawData);

        console.log(`Total categories in dump: ${Object.keys(categoriesDict).length}`);

        // 4. Filter categories (Descendants of ROOT_ID + Root itself)
        // Check filtering logic:
        // A category is relevant if its path_from_root contains the SOURCE_ROOT_ID.

        let categoriesToImport = Object.values(categoriesDict).filter(cat => {
            // Check if ID matches or if path contains root
            if (cat.id === SOURCE_ROOT_ID) return true;
            return cat.path_from_root && cat.path_from_root.some(node => node.id === SOURCE_ROOT_ID);
        });

        console.log(`Categories to import (children of ${SOURCE_ROOT_ID}): ${categoriesToImport.length}`);

        // 5. Sort by depth (path length) to ensure parents exist before children
        categoriesToImport.sort((a, b) => {
            const depthA = a.path_from_root ? a.path_from_root.length : 0;
            const depthB = b.path_from_root ? b.path_from_root.length : 0;
            return depthA - depthB;
        });

        // 6. Process Categories
        let processedCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        // Cache for looking up Rocket IDs by Meli ID
        // Map<MeliID, RocketID>
        const idMap = new Map();

        // Pre-fill/Cache existing mappings from DB to avoid failed lookups for already imported items
        console.log('Building existing mapping cache...');
        const existingCategories = await CategoryModel.find({
            "marketplaceMappings.marketplaceId": marketplaceId
        }).select('marketplaceMappings _id').lean();

        for (const cat of existingCategories) {
            const mapping = cat.marketplaceMappings.find(m =>
                String(m.marketplaceId) === String(marketplaceId) && m.externalId
            );
            if (mapping) {
                idMap.set(mapping.externalId, cat._id);
            }
        }
        console.log(`Loaded ${idMap.size} existing mappings.`);

        for (const meliCat of categoriesToImport) {
            try {
                // Determine Parent
                let rocketParentId = null;
                let rocketAncestors = [];

                if (meliCat.id !== SOURCE_ROOT_ID) {
                    // Find immediate parent in path
                    // path: [Root, ..., Parent, Self]
                    // Parent is at index length - 2
                    // But we filtered by `path_from_root` so we know they are in hierarchy.

                    // Careful: `path_from_root` sometimes might not match strict hierarchy if dump is inconsistent?
                    // Usually it is reliable.

                    const pathLength = meliCat.path_from_root.length;
                    if (pathLength < 2) {
                        // Should be at least Root -> Self (Length 2) for a child
                        // If length is 1, it's the root itself.
                        // But we handled root case above?
                        // If we are here, and not root ID, implies weird data or root child.
                        // Logic check:
                        // If filtered by "contains MLB5672", and sorted.
                        // MLB5672 (Length 1) comes first.
                    } else {
                        const parentNode = meliCat.path_from_root[pathLength - 2];
                        rocketParentId = idMap.get(parentNode.id);

                        if (!rocketParentId && parentNode.id === SOURCE_ROOT_ID) {
                            // If parent is the Root, and it wasn't in map yet (maybe first run?)
                            // We should have processed it first due to sort.
                        }

                        if (!rocketParentId) {
                            // Parent not found?
                            // Maybe parent wasn't in the filter? (Impossible if tree is consistent and we filter by root)
                            // OR parent creation failed.
                            console.warn(`Skipping ${meliCat.id} (${meliCat.name}): Parent ${parentNode.id} not found in Rocket.`);
                            errorCount++;
                            continue;
                        }

                        // Get parent document to get correct ancestors
                        const parentDoc = await CategoryModel.findById(rocketParentId).select('ancestors').lean();
                        if (parentDoc) {
                            rocketAncestors = [...(parentDoc.ancestors || []), parentDoc._id];
                        }
                    }
                }

                // Prepare Data
                const generatedSlug = slugify(meliCat.name);

                // Construct Meli Mapping Object
                const mappingObj = {
                    marketplaceId: marketplaceId,
                    externalId: meliCat.id,
                    externalName: meliCat.name,
                    path: meliCat.path_from_root.map(p => p.name).join(' > '),
                    attributeMappings: {} // Default empty
                };

                // Check if category already exists (by mapping)
                let categoryId = idMap.get(meliCat.id);
                let category;

                if (categoryId) {
                    // Update existing
                    category = await CategoryModel.findById(categoryId);
                    if (category) {
                        // Update Fields if necessary?
                        // Ideally we don't overwrite Name/Slug if user changed them?
                        // But for sync, we might want to ensure mapping is correct.

                        // We definitely update Mapping Path
                        const mIdx = category.marketplaceMappings.findIndex(m =>
                            String(m.marketplaceId) === String(marketplaceId) && m.externalId === meliCat.id
                        );
                        if (mIdx > -1) {
                            category.marketplaceMappings[mIdx].path = mappingObj.path;
                            category.marketplaceMappings[mIdx].externalName = mappingObj.externalName;
                        } else {
                            category.marketplaceMappings.push(mappingObj);
                        }

                        // Optional: Update parent/ancestors if structure changed? 
                        // Assuming structure is static for now to avoid complexity in this script.

                        await category.save();
                        updatedCount++;
                    }
                } else {
                    // Create New

                    // Check slug uniqueness collision (Auto-resolve)
                    let finalSlug = generatedSlug;
                    let counter = 1;
                    // Check globally because slug is unique across all categories
                    while (await CategoryModel.findOne({ slug: finalSlug })) {
                        finalSlug = `${generatedSlug}-${counter}`;
                        counter++;
                    }

                    category = new CategoryModel({
                        name: meliCat.name,
                        slug: finalSlug,
                        parentId: rocketParentId,
                        ancestors: rocketAncestors,
                        active: true,
                        marketplaceMappings: [mappingObj]
                    });

                    await category.save();
                    createdCount++;

                    // Update Cache
                    idMap.set(meliCat.id, category._id);
                }

                processedCount++;
                if (processedCount % 100 === 0) {
                    process.stdout.write(`\rProcessed: ${processedCount}/${categoriesToImport.length} | Created: ${createdCount} | Updated: ${updatedCount}`);
                }

            } catch (err) {
                console.error(`\nError processing ${meliCat.id}:`, err.message);
                errorCount++;
            }
        }

        console.log('\n----------------------------------------');
        console.log('Import Completed');
        console.log(`Total Processed: ${processedCount}`);
        console.log(`Created: ${createdCount}`);
        console.log(`Updated: ${updatedCount}`);
        console.log(`Errors: ${errorCount}`);

    } catch (error) {
        console.error('Script failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
}

run();
