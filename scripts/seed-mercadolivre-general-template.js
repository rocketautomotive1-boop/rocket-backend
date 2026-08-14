/**
 * Seed script — Template Mercado Livre GENERAL (saúde/beleza/suplementos/alimentos)
 *
 * Template default para produtos com domain:'general'. Espelha o fluxo do v3
 * (autopeças), mas com copy adequado a itens gerais: sem "veículo/montadora/
 * peça". A seleção por domínio é feita por MarketplaceTemplateRepository.findDefault
 * (campo `domain`).
 *
 * Placeholders usados (gerados pelo ProductFieldMapper):
 *   {produto} {marca} {condicao} {codigo} {atributos}
 *   {comprimento} {largura} {altura} {peso}
 *
 * Uso:
 *   node scripts/seed-mercadolivre-general-template.js
 *
 * Variável de ambiente: MONGO_URI
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const MARKETPLACE_NAME = 'Mercado Livre';
const DOMAIN = 'general';

// ─── Template body ────────────────────────────────────────────────────────────

const TEMPLATE_BODY = `{produto}
Marca: {marca}
Condição: {condicao}
EAN: {codigo}

[ATRIBUTOS_SECTION]
Especificações Técnicas:
{atributos}
[/ATRIBUTOS_SECTION]

[DESCRICAO_SECTION]
Sobre o produto:
{descricao}
[/DESCRICAO_SECTION]

Produto 100% original
* Itens lacrados e dentro da validade.
* Procedência garantida — sem falsificações.
* Armazenamento adequado até a entrega.

Dimensões: {comprimento}cm x {largura}cm x {altura}cm | Peso: {peso}kg

Como funciona o envio ?
* Entrega rápida e segura via Mercado Envios
* Compras confirmadas até 15h são enviadas no mesmo dia útil.

Compra 100% segura
* Pague em até 10x sem juros pelo Mercado Pago
* Proteção total ao comprador: receba o produto ou seu dinheiro de volta

Dúvidas frequentes
Como devo usar o produto ?
- Siga a sugestão de uso indicada na embalagem e no anúncio. Em caso de dúvida, consulte um profissional de saúde.

Está disponível para envio imediato ?
- Sim! Produto em estoque, pronto para envio.

E se eu quiser devolver ?
- A devolução é grátis pelo Mercado Livre e pode ser feita em até 30 dias.

Quem somos
Loja especializada com atendimento profissional, envio rápido e compromisso com a sua satisfação.

Ainda com dúvidas?
Use o campo de perguntas! Nossa equipe responde em poucos minutos.

Clique em "Comprar agora" e receba com segurança e confiança.`;

const NEW_TEMPLATE = {
  name: 'Template Mercado Livre Geral (saúde/suplementos)',
  title: '{produto} - {marca} | {descricao_curta}',
  template: TEMPLATE_BODY,
  isActive: true,
  isDefault: true,
  domain: DOMAIN,
  placeholders: {},
  sections: [
    {
      content: '[ATRIBUTOS_SECTION]\nEspecificações Técnicas:\n{atributos}\n[/ATRIBUTOS_SECTION]',
      condition: 'atributos_count > 0',
    },
    {
      content: '[DESCRICAO_SECTION]\nSobre o produto:\n{descricao}\n[/DESCRICAO_SECTION]',
      condition: "description != ''",
    },
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado ao MongoDB');

  const marketplaces = mongoose.connection.collection('marketplaces');

  const marketplace = await marketplaces.findOne({ name: { $regex: new RegExp(`^${MARKETPLACE_NAME}$`, 'i') } });
  if (!marketplace) {
    console.error(`❌ Marketplace "${MARKETPLACE_NAME}" não encontrado.`);
    process.exit(1);
  }

  console.log(`📦 Marketplace: ${marketplace.name} (${marketplace._id})`);

  const exists = (marketplace.templates || []).some(t => t.name === NEW_TEMPLATE.name);
  if (exists) {
    console.warn(`⚠️  Template "${NEW_TEMPLATE.name}" já existe. Nenhuma alteração feita.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // Desativa isDefault apenas de OUTROS templates do MESMO domínio (não toca autopeças).
  await marketplaces.updateOne(
    { _id: marketplace._id },
    { $set: { 'templates.$[t].isDefault': false } },
    { arrayFilters: [{ 't.domain': DOMAIN }] },
  );

  const result = await marketplaces.updateOne(
    { _id: marketplace._id },
    { $push: { templates: NEW_TEMPLATE } },
  );

  await mongoose.disconnect();

  if (result.modifiedCount === 1) {
    console.log(`✅ Template "${NEW_TEMPLATE.name}" (domain=${DOMAIN}) inserido como padrão do domínio.`);
  } else {
    console.error('❌ Falha ao inserir template.');
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
