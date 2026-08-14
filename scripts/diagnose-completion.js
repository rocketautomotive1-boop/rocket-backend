/* One-off: heal products whose images.length > 0 but completion.images === false.
 * Triggers Mongo update so the next /completion call still re-derives via the
 * controller path, but we also write the correct value directly here.
 *
 * Run: node scripts/diagnose-completion.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const stale = await db.collection('products')
    .find({
      $expr: {
        $and: [
          { $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] },
          { $eq: ['$completion.images', false] },
        ],
      },
    })
    .project({ _id: 1, partNumber: 1, images: 1 })
    .toArray();

  console.log(`Found ${stale.length} products with stale completion.images`);
  for (const p of stale) {
    const count = (p.images || []).length;
    console.log(`  - ${p.partNumber} (${p._id}) — ${count} image(s)`);
  }

  if (stale.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const ids = stale.map((p) => p._id);
  const res = await db.collection('products').updateMany(
    { _id: { $in: ids } },
    { $set: { 'completion.images': true } },
  );
  console.log(`Healed completion.images for ${res.modifiedCount} product(s).`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
