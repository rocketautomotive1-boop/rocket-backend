/**
 * Seed: template de descrição AUTOPEÇAS vinculado à conta "general" do Mercado Livre.
 *
 * Cria (ou atualiza, idempotente) um template default moderno para produtos
 * domain:autopecas, com accountId = conta "general". A resolução
 * (MarketplaceTemplateRepository.findDefault) só o escolhe quando a conta ATIVA
 * de publicação do ML (marketplace.activeAccountId) for a conta general.
 *
 * Precedência relevante:
 *   (autopecas/clássico + conta ativa)  >  (autopecas/clássico sem conta)
 *
 * NÃO zera o isDefault dos outros templates (insert direto, preservando o default
 * existente) — o template autopeças padrão das demais contas continua válido.
 *
 * Uso:
 *   cd backend && node scripts/seed-ml-autopecas-general-template.js
 *
 * Lê MONGO_URI do backend/.env (não hardcoda credenciais).
 * Idempotente: re-rodar atualiza o mesmo template (chave: name).
 *
 * ⚠️ Templates vivem no doc cacheado (MarketplaceConfigCacheService). Após rodar,
 *    reinicie o backend OU dispare a invalidação do cache para o novo template valer.
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const ML_TAG = 'mercadolivre';
const GENERAL_ACCOUNT_LABEL = 'general';
const TEMPLATE_NAME = 'Autopeças — Conta General (moderno)';

// Template moderno. Placeholders e condições seguem o que o TemplateEngine entende
// (mesmas chaves do template autopeças atual: {produto},{marca},{modelo},{condicao},
//  {descricao},{atributos},{detalhes},{observacao},{comprimento},{largura},{altura},{peso}).
const TEMPLATE_STRING = [
  '⚙️ {produto}',
  '',
  '🔧 Marca: {marca}',
  '🔖 Código da peça: {modelo}',
  '✅ Condição: {condicao}',
  '',
  '[DESCRICAO_SECTION]',
  '📋 SOBRE O PRODUTO',
  '{descricao}',
  '[/DESCRICAO_SECTION]',
  '',
  '[ATRIBUTOS_SECTION]',
  '📐 ESPECIFICAÇÕES TÉCNICAS',
  '{atributos}',
  '[/ATRIBUTOS_SECTION]',
  '',
  '[DETALHES_SECTION]',
  '🗒️ DETALHES ADICIONAIS',
  '{detalhes}',
  '[/DETALHES_SECTION]',
  '',
  '[GENUINO_SECTION]',
  '🛡️ PEÇA 100% ORIGINAL',
  '• Mesmo padrão utilizado pela montadora',
  '• Ajuste perfeito e durabilidade superior',
  '• Sem riscos de peças paralelas ou falsificadas',
  '[/GENUINO_SECTION]',
  '',
  '[AVARIADO_SECTION]',
  '⚠️ ATENÇÃO — PRODUTO COM AVARIA/DEFEITO',
  'Analise as fotos e a descrição com atenção antes de comprar.',
  '{observacao}',
  '[/AVARIADO_SECTION]',
  '',
  '📦 Dimensões: {comprimento}cm × {largura}cm × {altura}cm  |  Peso: {peso}kg',
  '',
  '🚚 ENVIO RÁPIDO E SEGURO',
  '• Despacho via Mercado Envios com código de rastreio',
  '• Pedidos aprovados até 15h saem no mesmo dia útil',
  '',
  '🔒 COMPRA 100% SEGURA',
  '• Até 10x sem juros pelo Mercado Pago',
  '• Proteção ao comprador: receba o produto ou seu dinheiro de volta',
  '',
  '❓ DÚVIDAS FREQUENTES',
  'Serve no meu veículo? Envie modelo, ano e motorização — confirmamos a compatibilidade.',
  'Tem pronta entrega? Sim, produto em estoque e pronto para envio.',
  'E se não servir? Devolução grátis pelo Mercado Livre em até 30 dias.',
  '',
  '🏪 Loja especializada em peças automotivas. Atendimento ágil e compromisso com a sua satisfação.',
  '',
  '👉 Clique em "Comprar agora" e receba com segurança e confiança.',
].join('\n');

const SECTIONS = [
  { content: "[DESCRICAO_SECTION]\n📋 SOBRE O PRODUTO\n{descricao}\n[/DESCRICAO_SECTION]", condition: "description != ''" },
  { content: "[ATRIBUTOS_SECTION]\n📐 ESPECIFICAÇÕES TÉCNICAS\n{atributos}\n[/ATRIBUTOS_SECTION]", condition: "atributos_count > 0" },
  { content: "[DETALHES_SECTION]\n🗒️ DETALHES ADICIONAIS\n{detalhes}\n[/DETALHES_SECTION]", condition: "details != ''" },
  { content: "[GENUINO_SECTION]\n🛡️ PEÇA 100% ORIGINAL\n• Mesmo padrão utilizado pela montadora\n• Ajuste perfeito e durabilidade superior\n• Sem riscos de peças paralelas ou falsificadas\n[/GENUINO_SECTION]", condition: "isGenuine == 1" },
  { content: "[AVARIADO_SECTION]\n⚠️ ATENÇÃO — PRODUTO COM AVARIA/DEFEITO\nAnalise as fotos e a descrição com atenção antes de comprar.\n{observacao}\n[/AVARIADO_SECTION]", condition: "situation == damaged" },
];

(async () => {
  if (!MONGO_URI) {
    console.error('✗ MONGO_URI não definido (verifique backend/.env).');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  // Usa o banco do próprio MONGO_URI (rocket_db).
  const db = client.db();
  const col = db.collection('marketplaces');

  const ml = await col.findOne({ tag: ML_TAG });
  if (!ml) {
    console.error(`✗ Marketplace tag="${ML_TAG}" não encontrado.`);
    process.exit(1);
  }

  const generalAccount = (ml.accounts || []).find((a) => a.label === GENERAL_ACCOUNT_LABEL);
  if (!generalAccount) {
    console.error(`✗ Conta label="${GENERAL_ACCOUNT_LABEL}" não encontrada no ML. Contas: ${JSON.stringify((ml.accounts || []).map((a) => a.label))}`);
    process.exit(1);
  }
  const accountId = String(generalAccount._id);
  console.log(`→ Conta general resolvida: ${accountId} (activeAccountId atual = ${ml.activeAccountId})`);

  const tplDoc = {
    name: TEMPLATE_NAME,
    title: '{produto} - {marca} {modelo} | {descricao_curta}',
    template: TEMPLATE_STRING,
    isActive: true,
    isDefault: true, // necessário p/ findDefault considerar; NÃO zeramos os demais.
    domain: undefined, // autopeças/clássico (ausente)
    accountId,
    placeholders: { garantia: 'Garantia de fábrica' },
    sections: SECTIONS,
  };

  const existingIdx = (ml.templates || []).findIndex((t) => t.name === TEMPLATE_NAME);

  if (existingIdx >= 0) {
    // Atualiza in-place (idempotente), preservando o _id do subdoc.
    const setOps = {};
    for (const [k, v] of Object.entries(tplDoc)) {
      if (v !== undefined) setOps[`templates.${existingIdx}.${k}`] = v;
    }
    await col.updateOne({ _id: ml._id }, { $set: setOps });
    console.log(`✓ Template "${TEMPLATE_NAME}" ATUALIZADO (idx ${existingIdx}).`);
  } else {
    // Insere sem tocar nos outros templates (preserva o default existente).
    const toPush = {};
    for (const [k, v] of Object.entries(tplDoc)) {
      if (v !== undefined) toPush[k] = v;
    }
    await col.updateOne({ _id: ml._id }, { $push: { templates: toPush } });
    console.log(`✓ Template "${TEMPLATE_NAME}" CRIADO e vinculado à conta general (${accountId}).`);
  }

  // Confirmação
  const after = await col.findOne({ _id: ml._id }, { projection: { templates: 1 } });
  const mine = (after.templates || []).find((t) => t.name === TEMPLATE_NAME);
  console.log('→ Persistido:', JSON.stringify({
    name: mine.name, isDefault: mine.isDefault, isActive: mine.isActive,
    domain: mine.domain ?? null, accountId: mine.accountId ?? null,
    sections: (mine.sections || []).length, len: (mine.template || '').length,
  }));

  console.log('\n⚠️  Templates vivem em cache (MarketplaceConfigCacheService).');
  console.log('   Reinicie o backend (ou invalide o cache) para o novo template valer.');
  console.log('   Ele só será escolhido para produtos domain:autopecas ENQUANTO a conta');
  console.log(`   ativa do ML for a "general" (activeAccountId === ${accountId}).`);

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
