const mongoose = require('mongoose');

// Connection URL
// Assuming local connection or matching the project's config.
// Use environment variable or default local URL. 
const MONGODB_URI = 'mongodb://localhost:27017/rocket'; // Adjust DB name if needed (usually 'rocket' or similar based on previous context)

async function removeInvalidMapping() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const CategoryMappingSchema = new mongoose.Schema({
            externalId: String,
            internalCategoryId: String
        }, { collection: 'category_mappings' });

        const CategoryMappingModel = mongoose.model('CategoryMapping', CategoryMappingSchema);

        const result = await CategoryMappingModel.deleteMany({ externalId: 'MLB1953' });
        console.log(`Deleted ${result.deletedCount} documents with externalId: MLB1953`);

    } catch (error) {
        console.error('Error removing mapping:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
}

removeInvalidMapping();
