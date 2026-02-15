const mongoose = require('mongoose');

const uri = 'mongodb://localhost:27017/rocket'; // Adjust if needed

const movementSchema = new mongoose.Schema({
    productId: mongoose.Schema.Types.ObjectId,
    type: String,
    quantity: Number,
    date: Date
});
const StockMovement = mongoose.model('StockMovement', movementSchema, 'stock_movements');

const productSchema = new mongoose.Schema({
    stockQuantity: Number,
    stockReserved: Number
});
const Product = mongoose.model('Product', productSchema, 'products');

async function run() {
    await mongoose.connect(uri);

    // ID from user request
    const productId = '695689621946eec2b3b71faf';

    console.log(`Checking product: ${productId}`);

    const product = await Product.findById(productId);
    console.log('Current Product State:', {
        stockQuantity: product?.stockQuantity,
        stockReserved: product?.stockReserved
    });

    const movements = await StockMovement.find({ productId: productId }).sort({ date: 1 });
    console.log(`\nFound ${movements.length} movements:`);

    let sum = 0;
    movements.forEach(m => {
        let change = 0;
        if (['inbound', 'purchase_return', 'adjustment_in'].includes(m.type)) change = m.quantity;
        else if (['outbound', 'sale', 'transfer'].includes(m.type)) change = -m.quantity;
        else if (m.type === 'adjustment') change = m.quantity; // adjustment is ambiguous, check value
        else if (m.type === 'reservation') return; // Ignore reservation for physical

        sum += change;
        console.log(`[${m.date.toISOString()}] ${m.type.padEnd(10)} Qty: ${m.quantity} -> Change: ${change} -> RunSum: ${sum}`);
    });

    console.log(`\nFinal Calculated Sum (Physical): ${sum}`);

    if (sum !== product.stockQuantity) {
        console.error('MISMATCH DETECTED!');
    } else {
        console.log('MATCH: Product stockQuantity matches history calculation.');
    }

    await mongoose.disconnect();
}

run().catch(console.error);
