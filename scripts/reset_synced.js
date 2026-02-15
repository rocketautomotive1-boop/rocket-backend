const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI;

async function resetSynced() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const CategorySchema = new mongoose.Schema({
            rocketSynced: Boolean,
        }, { collection: 'categories' });
        const CategoryModel = mongoose.model('Category', CategorySchema);

        // Reset ALL? Or just those that look suspicious?
        // For now, let's reset ALL categories that have been synced so the user can re-run the improved script.
        // We can filter if needed.

        const result = await CategoryModel.updateMany(
            { rocketSynced: true },
            {
                $set: { rocketSynced: false },
                $unset: {
                    aiReason: "",
                    synonyms: "",
                    usage: "",
                    relevance: "",
                    attributes: ""
                    // Note: We are NOT deleting the name/slug changes here, just the flag so they get processed again.
                    // Ideally, we should maybe revert name? But that's hard without history.
                    // However, the AI script overwrites name/slug/parent based on current mapping, so it should be fine to re-run.
                    // The "ensureParentPath" might create duplicates if we aren't careful, but the slug logic handles existing.
                }
            }
        );

        console.log(`Reset ${result.modifiedCount} categories. You can now re-run apply_category_refactor.js.`);

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

resetSynced();
