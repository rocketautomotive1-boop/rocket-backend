
const { MongoClient } = require('mongodb');

async function verifyData() {
    // Attempt standard local connection
    const uri = 'mongodb://localhost:27017/rocket';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('rocket');
        const ordersCollection = db.collection('orders');
        const movementsCollection = db.collection('stock_movements');

        const targetIds = ['260123QMY04FF7', '260123QHN3PXNH'];

        console.log('--- Checking Orders ---');
        for (const id of targetIds) {
            const order = await ordersCollection.findOne({ externalId: id });
            if (order) {
                console.log(`Order Found: ${id}`);
                console.log(`  _id: ${order._id}`);
                console.log(`  externalId: "${order.externalId}" (Length: ${order.externalId.length})`);
                console.log(`  logisticsStatus: ${order.logisticsStatus}`);
            } else {
                console.log(`Order NOT Found: ${id}`);
            }
        }

        console.log('\n--- Checking Stock Movements ---');
        for (const id of targetIds) {
            const movements = await movementsCollection.find({ reference: id }).toArray();
            console.log(`Movements for Reference: ${id} -> Count: ${movements.length}`);
            movements.forEach((m, i) => {
                console.log(`  [${i}] reference: "${m.reference}" (Length: ${m.reference.length})`);
                console.log(`  [${i}] type: ${m.type}`);
            });

            // Try fuzzy search/regex if exact fail
            if (movements.length === 0) {
                const regex = new RegExp(id);
                const fuzzy = await movementsCollection.find({ reference: regex }).toArray();
                if (fuzzy.length > 0) {
                    console.log(`    (Found ${fuzzy.length} via Regex match for "${id}")`);
                    fuzzy.forEach(m => console.log(`      -> "${m.reference}"`));
                } else {
                    console.log(`    (No fuzzy matches found either)`);
                }
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

verifyData();
