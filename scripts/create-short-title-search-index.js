// Cria (ou atualiza) o índice Atlas/mongot "short_title_search" na collection
// product_short_titles. Rodar com o túnel SSH pro Mongo da VPS já ativo
// (mesmo MONGO_URI usado pelo backend em dev).
//
// Uso: node scripts/create-short-title-search-index.js
require('dotenv').config();
const { MongoClient } = require('mongodb');
const indexDef = require('../src/product/atlas-search-index-short-title.json');

async function main() {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI não definido no .env');

    const client = await MongoClient.connect(uri);
    try {
        const db = client.db();
        const collection = db.collection('product_short_titles');

        const existing = await collection.listSearchIndexes(indexDef.name).toArray().catch(() => []);
        if (existing.length > 0) {
            console.log(`Índice "${indexDef.name}" já existe (status: ${existing[0].status}). Nada a fazer.`);
            console.log('Para recriar, apague antes: db.product_short_titles.dropSearchIndex("' + indexDef.name + '")');
            return;
        }

        const name = await collection.createSearchIndex({
            name: indexDef.name,
            definition: indexDef.mappings,
        });
        console.log(`Índice "${name}" criado. Aguardando ficar READY (pode levar alguns segundos)...`);

        for (let i = 0; i < 30; i++) {
            const [status] = await collection.listSearchIndexes(name).toArray();
            if (status?.queryable) {
                console.log('Índice pronto (queryable=true).');
                return;
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
        console.log('Índice ainda não ficou queryable após 60s — verifique manualmente.');
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    console.error('Falhou:', err.message);
    process.exit(1);
});
