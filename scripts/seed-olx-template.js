/**
 * Seed script — Template OLX com atributos
 *
 * Uso: node scripts/seed-olx-template.js
 * Variável de ambiente: MONGO_URI (padrão: mongodb://localhost:27017/rocket)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const MARKETPLACE_NAME = 'OLX';

const TEMPLATE_BODY = `{produto}
Código: {modelo} | Marca: {marca}
Condição: {condicao}

[DESCRICAO_SECTION]
{descricao}
[/DESCRICAO_SECTION]

[ATRIBUTOS_SECTION]
Especificações:
{atributos}
[/ATRIBUTOS_SECTION]

[DETALHES_SECTION]
Detalhes:
{detalhes}
[/DETALHES_SECTION]

[GENUINO_SECTION]
Produto Original - Peça genuína com garantia de fábrica.
[/GENUINO_SECTION]

Dimensões: {comprimento}cm x {largura}cm x {altura}cm | Peso: {peso}kg

Dúvidas? Entre em contato pelo chat!`;

const NEW_TEMPLATE = {
  name: 'Template OLX v1',
  title: '{produto} - {marca} {modelo}',
  template: TEMPLATE_BODY,
  isActive: true,
  isDefault: true,
  sections: [
    {
      content: '[DESCRICAO_SECTION]\n{descricao}\n[/DESCRICAO_SECTION]',
      condition: "description != ''",
    },
    {
      content: "[ATRIBUTOS_SECTION]\nEspecificações:\n{atributos}\n[/ATRIBUTOS_SECTION]",
      condition: "atributos_count > 0",
    },
    {
      content: "[DETALHES_SECTION]\nDetalhes:\n{detalhes}\n[/DETALHES_SECTION]",
      condition: "details != ''",
    },
    {
      content: "[GENUINO_SECTION]\nProduto Original - Peça genuína com garantia de fábrica.\n[/GENUINO_SECTION]",
      condition: 'isGenuine == 1',
    },
  ],
};

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado ao MongoDB:', MONGO_URI);

  const marketplaces = mongoose.connection.collection('marketplaces');
  const marketplace = await marketplaces.findOne({ name: { $regex: new RegExp(`^${MARKETPLACE_NAME}$`, 'i') } });
  if (!marketplace) {
    console.error(`❌ Marketplace "${MARKETPLACE_NAME}" não encontrado.`);
    process.exit(1);
  }

  console.log(`📦 Marketplace: ${marketplace.name} (${marketplace._id})`);

  const exists = (marketplace.templates || []).some(t => t.name === NEW_TEMPLATE.name);
  if (exists) {
    console.warn(`⚠️  Template "${NEW_TEMPLATE.name}" já existe.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  if (NEW_TEMPLATE.isDefault) {
    await marketplaces.updateOne(
      { _id: marketplace._id },
      { $set: { 'templates.$[].isDefault': false } },
    );
  }

  const result = await marketplaces.updateOne(
    { _id: marketplace._id },
    { $push: { templates: NEW_TEMPLATE } },
  );

  await mongoose.disconnect();
  console.log(result.modifiedCount === 1
    ? `✅ Template "${NEW_TEMPLATE.name}" inserido!`
    : '❌ Falha ao inserir.');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
