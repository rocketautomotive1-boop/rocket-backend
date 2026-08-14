/**
 * Diagnóstico: verifica credentials + token do Mercado Livre no DB.
 * Uso: npx ts-node scripts/check-ml-credentials.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  try {
    const Marketplace = mongoose.connection.collection('marketplaces');
    const mps = await Marketplace.find({
      $or: [{ tag: 'mercadolivre' }, { tag: 'mercado-livre' }, { name: 'Mercado Livre' }],
    }).toArray();

    if (mps.length === 0) {
      console.log('❌ Nenhum marketplace ML encontrado');
      return;
    }

    for (const mp of mps) {
      console.log(`\n=== Marketplace: ${mp.name} (tag=${mp.tag}, _id=${mp._id}) ===`);
      console.log(`tokenStrategy: ${mp.tokenStrategy}`);
      console.log(`enabled: ${mp.enabled}`);

      const creds = (mp.credentials || {}) as Record<string, any>;
      const credKeys = Object.keys(creds);
      console.log(`\nCredentials (${credKeys.length} keys):`);
      for (const k of credKeys) {
        const v = creds[k];
        const isEnc = typeof v === 'string' && v.startsWith('enc:v1:');
        console.log(`  ${k}: ${isEnc ? '🔐 encrypted (len ' + v.length + ')' : '⚠️ PLAINTEXT (' + String(v).slice(0, 20) + '...)'}`);
      }

      const tokens = (mp.tokens || []) as any[];
      console.log(`\nTokens: ${tokens.length}`);
      for (const t of tokens) {
        console.log(`  - isActive=${t.isActive} type=${t.tokenType}`);
        console.log(`    accessToken: ${t.accessToken ? t.accessToken.slice(0, 12) + '...' : 'NONE'}`);
        console.log(`    refreshToken: ${t.refreshToken ? t.refreshToken.slice(0, 12) + '...' : 'NONE'}`);
        console.log(`    expiresAt: ${t.expiresAt} (${t.expiresAt && new Date(t.expiresAt) < new Date() ? '❌ EXPIRED' : '✅ valid'})`);
        console.log(`    additionalData:`, JSON.stringify(t.additionalData));
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
