const mongoose = require('mongoose');
require('dotenv').config();

const userProductivitySchema = new mongoose.Schema({
    userId: String,
    date: Date,
    type: String,
    marketplaceId: mongoose.Schema.Types.ObjectId,
    productId: mongoose.Schema.Types.ObjectId,
    isError: Boolean,
    data: Object
}, { collection: 'user_productivity', timestamps: true });

const UserProductivity = mongoose.model('UserProductivity', userProductivitySchema);

async function run() {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/marketplace_integration';
    console.log('Connecting to:', uri);
    await mongoose.connect(uri);

    const userId = 'verify_user_1';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // clean up
    await UserProductivity.deleteMany({ userId });

    console.log('Inserting mock data...');
    const entries = [
        {
            userId,
            date: today,
            type: 'CREATE',
            data: { timestamp: new Date() }
        },
        {
            userId,
            date: today,
            type: 'SYNC_SUCCESS',
            isError: false,
            data: { price: 100, timestamp: new Date() },
            marketplaceId: new mongoose.Types.ObjectId() // Random ID
        },
        {
            userId,
            date: today,
            type: 'SYNC_SUCCESS',
            isError: false,
            data: { price: 50.50, timestamp: new Date() },
            marketplaceId: new mongoose.Types.ObjectId()
        },
        {
            userId,
            date: today,
            type: 'SYNC_ERROR',
            isError: true,
            data: { errorMessage: 'Fail' },
            marketplaceId: new mongoose.Types.ObjectId()
        }
    ];

    await UserProductivity.insertMany(entries);
    console.log('Data inserted.');

    console.log('Running aggregation...');
    const stats = await UserProductivity.aggregate([
        {
            $match: {
                userId: userId,
                date: today
            }
        },
        {
            $group: {
                _id: null,
                createdCount: {
                    $sum: { $cond: [{ $eq: ["$type", 'CREATE'] }, 1, 0] }
                },
                syncSuccessCount: {
                    $sum: { $cond: [{ $eq: ["$type", 'SYNC_SUCCESS'] }, 1, 0] }
                },
                publishedValue: {
                    $sum: {
                        $cond: [
                            { $eq: ["$type", 'SYNC_SUCCESS'] },
                            { $ifNull: ["$data.price", 0] },
                            0
                        ]
                    }
                },
                errorsCount: {
                    $sum: { $cond: [{ $eq: ["$isError", true] }, 1, 0] }
                }
            }
        }
    ]);

    console.log('Stats:', stats[0]);

    if (stats[0].createdCount === 1 && stats[0].syncSuccessCount === 2 && stats[0].publishedValue === 150.5 && stats[0].errorsCount === 1) {
        console.log('VERIFICATION SUCCESS');
    } else {
        console.log('VERIFICATION FAILED');
    }

    await mongoose.disconnect();
}

run().catch(console.error);
