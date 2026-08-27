require('dotenv').config();
const mongoose = require('mongoose');
const { Schema } = mongoose;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const TestSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, required: true },
    storeId: { type: Schema.Types.ObjectId, required: true },
  }, { collection: 'test_cast_scratch' });

  const TestModel = mongoose.model('TestCastScratch', TestSchema);

  const doc = await TestModel.create({ productId: '6a7cff4bf323afb241284d0c', storeId: '6a7cff4bf323afb241284d0e' });
  console.log('via create() - is ObjectId:', doc.productId instanceof mongoose.Types.ObjectId, doc.productId);

  const raw = await mongoose.connection.db.collection('test_cast_scratch').findOne({ _id: doc._id });
  console.log('raw from db - typeof productId:', typeof raw.productId, raw.productId);

  await mongoose.connection.db.collection('test_cast_scratch').deleteOne({ _id: doc._id });
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
