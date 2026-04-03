/**
 * Seed script — Template Mercado Livre v3
 *
 * Evolução do v2: adiciona seção de atributos/especificações técnicas
 * usando o placeholder {atributos} (gerado pelo ProductFieldMapper).
 *
 * Novos placeholders disponíveis:
 *   {atributos}        → lista "Nome: Valor" por linha (atributos Rocket)
 *   {atributos_tabela} → formato tabela com separador visual
 *   {atributos_count}  → contagem para condições
 *
 * Uso:
 *   node scripts/seed-mercadolivre-template-v3.js
 *
 * Variável de ambiente: MONGO_URI (padrão: mongodb://localhost:27017/rocket)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const MARKETPLACE_NAME = 'Mercado Livre';

// ─── Template body ────────────────────────────────────────────────────────────

const TEMPLATE_BODY = `{produto}
Código da peça: {modelo}
Marca: {marca}
Condição: {condicao}

[DESCRICAO_SECTION]
Sobre o produto:
{descricao}
[/DESCRICAO_SECTION]

[ATRIBUTOS_SECTION]
Especificações Técnicas:
{atributos}
[/ATRIBUTOS_SECTION]

[DETALHES_SECTION]
Detalhes Adicionais:
{detalhes}
[/DETALHES_SECTION]

[GENUINO_SECTION]
Produto 100% original (garantia de qualidade)
* Peça genuína, mesmo padrão utilizado pela montadora
* Durabilidade superior e ajuste perfeito no seu veículo.
* Evite problemas com peças paralelas ou falsificadas.
[/GENUINO_SECTION]

[AVARIADO_SECTION]
⚠️ ATENÇÃO — PRODUTO COM AVARIA/DEFEITO
Analise as fotos e a descrição cuidadosamente antes de efetuar a compra.
{observacao}
[/AVARIADO_SECTION]

Dimensões: {comprimento}cm x {largura}cm x {altura}cm | Peso: {peso}kg

Como funciona o envio ?
* Entrega rápida e segura via Mercado Envios
* Compras confirmadas até 15h são enviadas no mesmo dia útil.

Compra 100% segura
* Pague em até 10x sem juros pelo Mercado Pago
* Proteção total ao comprador: receba o produto ou seu dinheiro de volta

Dúvidas frequentes
Serve no meu veículo ?
- Envie os dados do seu carro (modelo, ano, motorização). Ajudamos a confirmar a compatibilidade.

Está disponível para envio imediato ?
- Sim! Produto em estoque, pronto para envio.

E se não servir ?
- A devolução é grátis pelo Mercado Livre e pode ser feita em até 30 dias.

Quem somos
Somos uma loja especializada em peças automotivas genuínas. Atendimento profissional, envio rápido e compromisso com a sua satisfação.

Ainda com dúvidas?
Use o campo de perguntas! Nossa equipe responde em poucos minutos.

Clique em "Comprar agora" e receba com segurança e confiança.`;

const NEW_TEMPLATE = {
  name: 'Template Completo Mercado Livre v3',
  title: '{produto} - {marca} {modelo} | {descricao_curta}',
  template: TEMPLATE_BODY,
  isActive: true,
  isDefault: true,
  placeholders: {
    garantia: 'Garantia de fábrica',
  },
  sections: [
    {
      content: '[DESCRICAO_SECTION]\nSobre o produto:\n{descricao}\n[/DESCRICAO_SECTION]',
      condition: "description != ''",
    },
    {
      content: '[ATRIBUTOS_SECTION]\nEspecificações Técnicas:\n{atributos}\n[/ATRIBUTOS_SECTION]',
      condition: "atributos_count > 0",
    },
    {
      content: '[DETALHES_SECTION]\nDetalhes Adicionais:\n{detalhes}\n[/DETALHES_SECTION]',
      condition: "details != ''",
    },
    {
      content: '[GENUINO_SECTION]\nProduto 100% original (garantia de qualidade)\n* Peça genuína, mesmo padrão utilizado pela montadora\n* Durabilidade superior e ajuste perfeito no seu veículo.\n* Evite problemas com peças paralelas ou falsificadas.\n[/GENUINO_SECTION]',
      condition: 'isGenuine == 1',
    },
    {
      content: '[AVARIADO_SECTION]\n⚠️ ATENÇÃO — PRODUTO COM AVARIA/DEFEITO\nAnalise as fotos e a descrição cuidadosamente antes de efetuar a compra.\n{observacao}\n[/AVARIADO_SECTION]',
      condition: 'condition == damaged',
    },
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado ao MongoDB:', MONGO_URI);

  const marketplaces = mongoose.connection.collection('marketplaces');

  const marketplace = await marketplaces.findOne({ name: { $regex: new RegExp(`^${MARKETPLACE_NAME}$`, 'i') } });
  if (!marketplace) {
    console.error(`❌ Marketplace "${MARKETPLACE_NAME}" não encontrado.`);
    process.exit(1);
  }

  console.log(`📦 Marketplace encontrado: ${marketplace.name} (${marketplace._id})`);
  console.log(`   Templates existentes: ${(marketplace.templates || []).length}`);

  // Verifica se já existe um template com o mesmo nome
  const exists = (marketplace.templates || []).some(t => t.name === NEW_TEMPLATE.name);
  if (exists) {
    console.warn(`⚠️  Template "${NEW_TEMPLATE.name}" já existe. Nenhuma alteração feita.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // Desativa isDefault dos templates anteriores se o novo será default
  if (NEW_TEMPLATE.isDefault) {
    await marketplaces.updateOne(
      { _id: marketplace._id },
      { $set: { 'templates.$[].isDefault': false } },
    );
    console.log('   Templates anteriores: isDefault → false');
  }

  const result = await marketplaces.updateOne(
    { _id: marketplace._id },
    { $push: { templates: NEW_TEMPLATE } },
  );

  await mongoose.disconnect();

  if (result.modifiedCount === 1) {
    console.log(`✅ Template "${NEW_TEMPLATE.name}" inserido com sucesso!`);
    if (NEW_TEMPLATE.isDefault) {
      console.log('   ✅ Definido como template padrão.');
    }
  } else {
    console.error('❌ Falha ao inserir template.');
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
