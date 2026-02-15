
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    partNumber: { type: String, required: true },
    sku: Number,
    name: String,
    ncm: String,
    cfop: String,
    origin: String,
    brand: Object
}, { strict: false });

const ProductModel = mongoose.model('Product', productSchema, 'products');

async function run() {
    console.log('Connecting to MongoDB...');
    const uri = 'mongodb+srv://rocketautomotive:Rocket160387@cluster0.dqmoenp.mongodb.net/rocket_db?appName=Cluster0';

    await mongoose.connect(uri);
    console.log('Connected.');

    const rnd = Math.floor(Math.random() * 100000);
    const sku = 99900000 + rnd; // high sku to avoid collision

    try {
        console.log(`Creating test product SKU ${sku}...`);
        await ProductModel.create({
            partNumber: `TEST-LIGHT-${rnd}`,
            name: `Test Light ${rnd}`,
            sku: sku,
            brand: { id: 1, name: 'Test' }
        });

        console.log('Product created. Updating NCM...');

        // Emulate updateDetails logic
        await ProductModel.updateOne({ sku: sku }, {
            $set: {
                ncm: '87654321',
                cfop: '5405'
            }
        });

        console.log('Update done. Fetching...');
        const fetched = await ProductModel.findOne({ sku: sku }).lean();

        console.log('Fetched document (ncm/cfop):', JSON.stringify({
            ncm: (fetched as any).ncm,
            cfop: (fetched as any).cfop
        }, null, 2));

        if ((fetched as any).ncm === '87654321') {
            console.log('SUCCESS: NCM is persisted.');
        } else {
            console.error('FAILURE: NCM not found in document.');
            console.log('Full doc:', fetched);
        }

        await ProductModel.deleteOne({ sku: sku });
        console.log('Cleanup done.');

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
