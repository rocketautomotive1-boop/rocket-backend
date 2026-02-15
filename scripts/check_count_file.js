const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rocket';

async function run() {
    try {
        await mongoose.connect(MONGODB_URI);
        const count = await mongoose.connection.db.collection('categories').countDocuments({
            "marketplaceMappings.marketplaceId": { $exists: true }
        });
        fs.writeFileSync('count.txt', String(count));
    } catch (e) {
        console.error(e);
        fs.writeFileSync('count.txt', 'ERROR');
    } finally {
        await mongoose.disconnect();
    }
}
run();
