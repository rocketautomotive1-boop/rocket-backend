/**
 * Corrige a condição da GENUINO_SECTION no template Mercado Livre:
 *   isGenuine == 1  →  brand.isGenuine == 1
 *
 * O campo isGenuine está em product.brand.isGenuine (subdocumento),
 * não na raiz do produto.
 *
 * Uso:
 *   MONGO_URI=<uri> node scripts/fix-genuino-condition.js
 */
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rocket';
const MARKETPLACE_NAME = 'Mercado Livre';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado ao MongoDB');

  const marketplaces = mongoose.connection.collection('marketplaces');
  const marketplace = await marketplaces.findOne({
    name: { $regex: new RegExp(`^${MARKETPLACE_NAME}$`, 'i') },
  });

  if (!marketplace) {
    console.error(`❌ Marketplace "${MARKETPLACE_NAME}" não encontrado.`);
    process.exit(1);
  }

  const templates = marketplace.templates || [];
  let fixed = 0;

  for (const tpl of templates) {
    if (!tpl.sections) continue;
    for (const section of tpl.sections) {
      if (section.condition === 'isGenuine == 1') {
        section.condition = 'brand.isGenuine == 1';
        fixed++;
        console.log(`  ✏️  Template "${tpl.name}" — condição corrigida: ${section.condition}`);
      }
    }
  }

  if (fixed === 0) {
    console.log('ℹ️  Nenhuma condição "isGenuine == 1" encontrada. Já pode estar corrigido.');
  } else {
    await marketplaces.updateOne(
      { _id: marketplace._id },
      { $set: { templates } },
    );
    console.log(`✅ ${fixed} condição(ões) corrigida(s) e salva(s).`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
