const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI;

async function checkRefactored() {
    try {
        await mongoose.connect(MONGODB_URI);

        const CategorySchema = new mongoose.Schema({
            name: String,
            slug: String,
            parentId: mongoose.Schema.Types.ObjectId,
            ancestors: [mongoose.Schema.Types.ObjectId],
            rocketSynced: Boolean,
            synonyms: [String],
            attributes: [String],
            aiReason: String,
            marketplaceMappings: Array
        }, { collection: 'categories' });
        const CategoryModel = mongoose.model('Category', CategorySchema);

        const totalRefactored = await CategoryModel.countDocuments({ rocketSynced: true });
        console.log(`Total Refactored/Synced Categories: ${totalRefactored}`);

        const samples = await CategoryModel.find({ rocketSynced: true }).limit(5).lean();

        console.log('\n--- Verify Samples ---');
        for (const s of samples) {
            console.log(`Name: ${s.name}`);
            console.log(`Slug: ${s.slug}`);
            console.log(`Path: ${s.ancestors.length} ancestors`);
            console.log(`Metadata: Synonyms=${s.synonyms?.length}, Attributes=${s.attributes?.length}`);
            console.log(`Reason: ${s.aiReason}`);
            console.log('-----------------------');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

checkRefactored();
