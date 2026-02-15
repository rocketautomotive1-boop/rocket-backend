
const mongoose = require('mongoose');
const fs = require('fs');

async function verifyData() {
    const uri = 'mongodb+srv://rocketautomotive:Rocket160387@cluster0.dqmoenp.mongodb.net/rocket_db?appName=Cluster0';
    const logFile = 'verify_output.txt';
    const log = (msg) => {
        console.log(msg);
        fs.appendFileSync(logFile, msg + '\n');
    };

    fs.writeFileSync(logFile, ''); // Clear file

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
        log('Connected to MongoDB via Mongoose');

        const OrderSchema = new mongoose.Schema({}, { strict: false });
        const StockMovementSchema = new mongoose.Schema({}, { strict: false, collection: 'stock_movements' });

        const OrderModel = mongoose.model('Order', OrderSchema, 'orders');
        const StockMovementModel = mongoose.model('StockMovement', StockMovementSchema, 'stock_movements');

        const targetIds = ['260123QMY04FF7', '260123QHN3PXNH'];

        log('--- Checking Orders ---');
        for (const id of targetIds) {
            const order = await OrderModel.findOne({ externalId: id }).lean();
            if (order) {
                log(`Order Found: ${id}`);
                log(`  _id: ${order._id}`);
                log(`  externalId type: ${typeof order.externalId}`);
                log(`  externalId value: "${order.externalId}"`);
                log(`  logisticsStatus: ${order.logisticsStatus}`);
            } else {
                log(`Order NOT Found: ${id}`);
            }
        }

        log('\n--- Checking Stock Movements ---');
        for (const id of targetIds) {
            log(`Searching for reference: "${id}"`);
            const movements = await StockMovementModel.find({ reference: id }).lean();
            log(`  Found: ${movements.length}`);

            if (movements.length > 0) {
                movements.forEach(m => log(`   -> Match: "${m.reference}" (ID: ${m._id})`));
            } else {
                // Try exact regex to see if it's hidden chars
                const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`^${escapedId}$`);
                const exactRegex = await StockMovementModel.find({ reference: regex }).lean();
                log(`  Regex Exact Match Count: ${exactRegex.length}`);

                // Try fuzzy
                const fuzzy = await StockMovementModel.find({ reference: { $regex: id } }).lean();
                log(`  Fuzzy Match Count: ${fuzzy.length}`);
                if (fuzzy.length > 0) {
                    fuzzy.forEach(m => log(`   -> Found fuzzy: "${m.reference}"`));
                }
            }
        }

    } catch (e) {
        log('Script Error: ' + e.message);
    } finally {
        await mongoose.disconnect();
    }
}

verifyData();
