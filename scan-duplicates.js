
const mongoose = require('mongoose');

// Adjust connection string
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rocketautomotive:Rocket160387@cluster0.dqmoenp.mongodb.net/rocket_db?appName=Cluster0';

const productSchema = new mongoose.Schema({
    name: String,
    titles: [
        {
            title: String,
            marketplaceId: mongoose.Schema.Types.Mixed,
            externalId: String
        }
    ]
});

const Product = mongoose.model('Product', productSchema, 'products');

async function scan() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const products = await Product.find({ 'titles.1': { $exists: true } }).select('titles name').lean();
        console.log(`Scanning ${products.length} products with multiple titles...`);

        let duplicateCount = 0;

        for (const p of products) {
            const map = new Map();
            let hasDup = false;
            for (const t of p.titles) {
                const mId = String(t.marketplaceId);
                if (map.has(mId)) {
                    hasDup = true;
                    console.log(`[DUPLICATE FOUND] Product ${p._id} (${p.name})`);
                    console.log(`   - Title A: "${map.get(mId).title}" (ExtID: ${map.get(mId).externalId})`);
                    console.log(`   - Title B: "${t.title}" (ExtID: ${t.externalId})`);
                    console.log(`   - MarketplaceID: ${mId}`);
                }
                map.set(mId, t);
            }
            if (hasDup) duplicateCount++;
        }

        console.log(`Scan complete. Found ${duplicateCount} products with duplicate titles.`);

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

scan();
