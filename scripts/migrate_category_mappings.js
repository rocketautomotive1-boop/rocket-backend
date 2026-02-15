const mongoose = require('mongoose');

// Connection URL
const MONGODB_URI = 'mongodb://localhost:27017/rocket';

async function migrateMappings() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // Schemas
        const CategorySchema = new mongoose.Schema({
            name: String,
            marketplaceMappings: { type: Array, default: [] }
        }, { collection: 'categories', strict: false });

        const CategoryMappingSchema = new mongoose.Schema({
            internalCategoryId: String,
            internalCategoryName: String,
            externalId: String,
            externalName: String,
            marketplace: { type: mongoose.Schema.Types.ObjectId, ref: 'Marketplace' },
            internalCategoryPath: String,
            attributeMappings: Object
        }, { collection: 'category_mappings' });

        const CategoryModel = mongoose.model('Category', CategorySchema);
        const CategoryMappingModel = mongoose.model('CategoryMapping', CategoryMappingSchema);

        // Fetch all legacy mappings
        const mappings = await CategoryMappingModel.find({});
        console.log(`Found ${mappings.length} mappings to migrate.`);

        for (const mapping of mappings) {
            if (!mapping.internalCategoryId) {
                console.warn(`Skipping mapping without internalCategoryId: ${mapping._id}`);
                continue;
            }

            const category = await CategoryModel.findById(mapping.internalCategoryId);
            if (!category) {
                console.warn(`Internal category not found for mapping: ${mapping.internalCategoryId}`);
                continue;
            }

            // Check if already mapped
            const existingIndex = category.marketplaceMappings.findIndex(m =>
                String(m.marketplaceId) === String(mapping.marketplace) &&
                m.externalId === mapping.externalId
            );

            if (existingIndex === -1) {
                category.marketplaceMappings.push({
                    marketplaceId: mapping.marketplace,
                    externalId: mapping.externalId,
                    externalName: mapping.externalName || 'Migrated Category',
                    path: mapping.internalCategoryPath || '',
                    attributeMappings: mapping.attributeMappings || {}
                });
                await category.save();
                console.log(`Migrated mapping for category: ${category.name} -> ${mapping.externalId}`);
            } else {
                console.log(`Mapping already exists for: ${category.name}`);
            }
        }

        console.log('Migration completed successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
}

migrateMappings();
