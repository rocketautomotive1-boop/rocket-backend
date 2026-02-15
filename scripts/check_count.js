const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rocket';

async function run() {
    try {
        await mongoose.connect(MONGODB_URI);
        const count = await mongoose.connection.db.collection('categories').countDocuments({
            "marketplaceMappings.marketplaceId": { $exists: true }
        });
        console.log(`COUNT: ${count}`);
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
run();
