/**
 * Ativa o "Template Completo Mercado Livre v2" como padrão,
 * desativando o template atual.
 *
 * Uso:
 *   node scripts/activate-mercadolivre-template-v2.js
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/rocket';
const MARKETPLACE_NAME = 'Mercado Livre';
const NEW_TEMPLATE_NAME = 'Template Completo Mercado Livre v2';

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
  console.log(`📦 Templates encontrados: ${templates.length}`);
  templates.forEach((t, i) => console.log(`   [${i}] ${t.name} — isDefault: ${t.isDefault}, isActive: ${t.isActive}`));

  const v2 = templates.find(t => t.name === NEW_TEMPLATE_NAME);
  if (!v2) {
    console.error(`❌ Template "${NEW_TEMPLATE_NAME}" não encontrado. Execute o seed primeiro.`);
    process.exit(1);
  }

  // Desmarca todos e marca o v2 como default
  const updatedTemplates = templates.map(t => ({
    ...t,
    isDefault: t.name === NEW_TEMPLATE_NAME,
  }));

  await marketplaces.updateOne(
    { _id: marketplace._id },
    { $set: { templates: updatedTemplates } },
  );

  await mongoose.disconnect();
  console.log(`\n✅ "${NEW_TEMPLATE_NAME}" agora é o template padrão.`);
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
