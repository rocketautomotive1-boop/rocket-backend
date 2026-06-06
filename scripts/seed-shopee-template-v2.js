/**
 * Seed script - Template Shopee v2 (com secoes condicionais).
 *
 * Uso:
 *   node scripts/seed-shopee-template-v2.js
 *
 * Requisitos:
 *   MONGO_URI no ambiente.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const MARKETPLACE_NAME = 'Shopee';

const TEMPLATE_BODY = `{produto}
Codigo da peca: {modelo}
Marca: {marca}
Condicao: {condicao}

[DESCRICAO_SECTION]
Sobre o produto:
{descricao}
[/DESCRICAO_SECTION]

[ATRIBUTOS_SECTION]
Especificacoes tecnicas:
{atributos}
[/ATRIBUTOS_SECTION]

[DETALHES_SECTION]
Detalhes adicionais:
{detalhes}
[/DETALHES_SECTION]

[GENUINO_SECTION]
Produto 100% original (garantia de qualidade)
* Peca genuina, mesmo padrao utilizado pela montadora
* Durabilidade superior e ajuste perfeito no seu veiculo
* Evite problemas com pecas paralelas ou falsificadas
[/GENUINO_SECTION]

[AVARIADO_SECTION]
ATENCAO - PRODUTO COM AVARIA/DEFEITO
Analise as fotos e a descricao cuidadosamente antes de efetuar a compra.
{observacao}
[/AVARIADO_SECTION]

Dimensoes: {comprimento}cm x {largura}cm x {altura}cm | Peso: {peso}kg

Envio rapido e seguro:
* Compras confirmadas ate 15h sao enviadas no mesmo dia util
* Produto em estoque e pronto para despacho

Compra segura:
* Protecao ao comprador pela Shopee
* Suporte pos-venda da nossa equipe

Dicas antes da compra:
* Confirme compatibilidade com modelo, ano e motorizacao do veiculo
* Em caso de duvida, use o campo de perguntas`;

const NEW_TEMPLATE = {
  name: 'Template Shopee v2',
  title: '{produto} - {marca} {modelo} | {descricao_curta}',
  template: TEMPLATE_BODY,
  isActive: true,
  isDefault: true,
  placeholders: {
    garantia: 'Garantia de fabrica',
  },
  sections: [
    {
      content: '[DESCRICAO_SECTION]\nSobre o produto:\n{descricao}\n[/DESCRICAO_SECTION]',
      condition: "description != ''",
    },
    {
      content: '[ATRIBUTOS_SECTION]\nEspecificacoes tecnicas:\n{atributos}\n[/ATRIBUTOS_SECTION]',
      condition: 'atributos_count > 0',
    },
    {
      content: '[DETALHES_SECTION]\nDetalhes adicionais:\n{detalhes}\n[/DETALHES_SECTION]',
      condition: "details != ''",
    },
    {
      content: '[GENUINO_SECTION]\nProduto 100% original (garantia de qualidade)\n* Peca genuina, mesmo padrao utilizado pela montadora\n* Durabilidade superior e ajuste perfeito no seu veiculo\n* Evite problemas com pecas paralelas ou falsificadas\n[/GENUINO_SECTION]',
      condition: 'isGenuine == 1',
    },
    {
      content: '[AVARIADO_SECTION]\nATENCAO - PRODUTO COM AVARIA/DEFEITO\nAnalise as fotos e a descricao cuidadosamente antes de efetuar a compra.\n{observacao}\n[/AVARIADO_SECTION]',
      condition: 'condition == damaged',
    },
  ],
};

async function main() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI nao definido.');
  }

  await mongoose.connect(MONGO_URI);
  console.log('Conectado ao MongoDB.');

  const marketplaces = mongoose.connection.collection('marketplaces');
  const marketplace = await marketplaces.findOne({
    name: { $regex: new RegExp(`^${MARKETPLACE_NAME}$`, 'i') },
  });

  if (!marketplace) {
    throw new Error(`Marketplace "${MARKETPLACE_NAME}" nao encontrado.`);
  }

  const existingTemplates = Array.isArray(marketplace.templates) ? marketplace.templates : [];
  const alreadyExists = existingTemplates.some((t) => t.name === NEW_TEMPLATE.name);

  if (alreadyExists) {
    console.log(`Template "${NEW_TEMPLATE.name}" ja existe. Atualizando para manter consistencia...`);
    await marketplaces.updateOne(
      { _id: marketplace._id, 'templates.name': NEW_TEMPLATE.name },
      {
        $set: {
          'templates.$.title': NEW_TEMPLATE.title,
          'templates.$.template': NEW_TEMPLATE.template,
          'templates.$.isActive': true,
          'templates.$.isDefault': true,
          'templates.$.placeholders': NEW_TEMPLATE.placeholders,
          'templates.$.sections': NEW_TEMPLATE.sections,
        },
      },
    );
  } else {
    if (NEW_TEMPLATE.isDefault) {
      await marketplaces.updateOne(
        { _id: marketplace._id },
        { $set: { 'templates.$[].isDefault': false } },
      );
    }

    await marketplaces.updateOne(
      { _id: marketplace._id },
      { $push: { templates: NEW_TEMPLATE } },
    );
  }

  // Garante apenas o v2 como default para evitar ambiguidade.
  await marketplaces.updateOne(
    { _id: marketplace._id },
    {
      $set: {
        'templates.$[notV2].isDefault': false,
      },
    },
    {
      arrayFilters: [{ 'notV2.name': { $ne: NEW_TEMPLATE.name } }],
    },
  );

  await mongoose.disconnect();
  console.log('Template Shopee v2 aplicado com sucesso.');
}

main().catch(async (err) => {
  console.error('Erro:', err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
