
import mongoose from 'mongoose';
import { Types } from 'mongoose';

const productSchema = new mongoose.Schema({
    partNumber: { type: String, required: true },
    sku: Number,
    dimensions: {
        height: Types.Decimal128,
        width: Types.Decimal128
    },
    weight: Types.Decimal128
}, { strict: false });

const ProductModel = mongoose.model('Product', productSchema, 'products');

async function run() {
    console.log('Connecting to MongoDB...');
    const uri = 'mongodb+srv://rocketautomotive:Rocket160387@cluster0.dqmoenp.mongodb.net/rocket_db?appName=Cluster0';

    await mongoose.connect(uri);
    console.log('Connected.');

    const rnd = Math.floor(Math.random() * 100000);
    const sku = 99800000 + rnd;

    try {
        console.log(`Creating test product SKU ${sku}...`);
        await ProductModel.create({
            partNumber: `TEST-JSON-${rnd}`,
            sku: sku,
            weight: Types.Decimal128.fromString('1.23'),
            dimensions: {
                height: Types.Decimal128.fromString('10.5')
            }
        });

        console.log('Fetching lean()...');
        const fetched = await ProductModel.findOne({ sku: sku }).lean();

        console.log('--- JSON.stringify Output ---');
        console.log(JSON.stringify(fetched, null, 2));
        console.log('-----------------------------');

        await ProductModel.deleteOne({ sku: sku });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}

run();
