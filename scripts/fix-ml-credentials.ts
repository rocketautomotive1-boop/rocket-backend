/**
 * Migra clientSecret de token.additionalData → credentials (criptografado).
 * Uso: npx ts-node scripts/fix-ml-credentials.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { encrypt } from '../src/marketplace/auth/services/credentials-crypto.helper';

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  try {
    const Marketplace = mongoose.connection.collection('marketplaces');
    const mp = await Marketplace.findOne({ tag: 'mercadolivre' });
    if (!mp) {
      console.error('❌ Marketplace mercadolivre não encontrado');
      return;
    }

    const activeToken = (mp.tokens || []).find((t: any) => t.isActive);
    const ad = activeToken?.additionalData || {};

    const updates: Record<string, string> = {};
    const current = (mp.credentials || {}) as Record<string, string>;

    if (!current.clientSecret && ad.clientSecret) {
      updates['credentials.clientSecret'] = encrypt(ad.clientSecret);
      console.log(`✅ clientSecret será migrado: ${String(ad.clientSecret).slice(0, 8)}... → encrypted`);
    } else if (current.clientSecret) {
      console.log('ℹ️  clientSecret já existe em credentials, pulando.');
    } else {
      console.log('❌ clientSecret não encontrado em token.additionalData. Precisa ser configurado manualmente.');
    }

    if (!current.clientId && ad.clientId) {
      updates['credentials.clientId'] = encrypt(String(ad.clientId));
      console.log(`✅ clientId será migrado: ${ad.clientId}`);
    }

    if (Object.keys(updates).length === 0) {
      console.log('\nNada a fazer.');
      return;
    }

    await Marketplace.updateOne({ _id: mp._id }, { $set: updates });
    console.log(`\n✅ Migração concluída: ${Object.keys(updates).join(', ')}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
