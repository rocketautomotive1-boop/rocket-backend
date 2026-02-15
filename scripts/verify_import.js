const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rocket';

async function verify() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const CategorySchema = new mongoose.Schema({
            marketplaceMappings: Array
        }, { collection: 'categories', strict: false });

        const MarketplaceSchema = new mongoose.Schema({
            name: String
        }, { collection: 'marketplaces' });

        const CategoryModel = mongoose.model('Category', CategorySchema);
        const MarketplaceModel = mongoose.model('Marketplace', MarketplaceSchema);

        const marketplace = await MarketplaceModel.findOne({ name: 'Mercado Livre' });
        if (!marketplace) throw new Error('Marketplace not found');

        const count = await CategoryModel.countDocuments({
            "marketplaceMappings.marketplaceId": marketplace._id,
        });

        console.log(`Total Categories with Mercado Livre mapping: ${count}`);

        // Sample check for a known category
        // "Amortecedores" is usually a child. Let's find one by externalId if possible, or just sample some.
        const samples = await CategoryModel.find({
            "marketplaceMappings.marketplaceId": marketplace._id
        }).limit(5).lean();

        console.log('Sample categories:', JSON.stringify(samples.map(c => ({
            name: c.name,
            mappings: c.marketplaceMappings.filter(m => String(m.marketplaceId) === String(marketplace._id))
        })), null, 2));

    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
}

verify();
