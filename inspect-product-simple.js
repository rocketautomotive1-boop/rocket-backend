
const mongoose = require('mongoose');

// Adjust connection string as needed, usually from .env or default local
const MONGO_URI = 'mongodb+srv://rocketautomotive:Rocket160387@cluster0.dqmoenp.mongodb.net/rocket_db?appName=Cluster0';

const productSchema = new mongoose.Schema({
    name: String,
    titles: [
        {
            title: String,
            marketplaceId: mongoose.Schema.Types.ObjectId,
            externalId: String,
            // allow flexible schema for check
        }
    ]
}, { strict: false });

const Product = mongoose.model('Product', productSchema);

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const productId = '696a434bf40b34995533acec';
        const product = await Product.findById(productId);

        if (!product) {
            console.log('Product not found');
        } else {
            const fs = require('fs');
            fs.writeFileSync('product-titles.json', JSON.stringify(product.titles, null, 2));
            console.log('Wrote titles to product-titles.json');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
