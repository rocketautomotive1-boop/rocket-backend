import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { decrypt, isEncrypted } from '../src/marketplace/credentials/credentials-crypto.helper';

dotenvConfig();

// Conta a re-autorizar (general) — mesma resolução de credenciais do broker:
// override cifrado na conta → marketplaces.credentials (por id) → tag/env.
const TARGET_ACCOUNT_LABEL = 'general';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const apiBase = process.env.API_BASE_URL;
  if (!uri) throw new Error('Missing MONGO_URI');
  if (!apiBase) throw new Error('Missing API_BASE_URL (redirect_uri)');

  await mongoose.connect(uri);
  const mp: any = await mongoose.connection.db
    .collection('marketplaces')
    .findOne({ name: /mercado livre/i });
  if (!mp) throw new Error('Mercado Livre marketplace not found');

  const acc = (mp.accounts ?? []).find((a: any) => a.label === TARGET_ACCOUNT_LABEL);
  if (!acc) throw new Error(`Account ${TARGET_ACCOUNT_LABEL} not found`);

  const dec = (v?: string) => (v ? (isEncrypted(v) ? decrypt(v) : v) : undefined);
  const clientId =
    dec(acc.credentials?.clientId) ?? dec(mp.credentials?.clientId);
  if (!clientId) throw new Error('clientId não resolvido p/ a conta');

  const redirectUri = apiBase; // raiz, match exato com a app ML
  const state = String(acc._id); // accountId trafega no state
  const authUrl =
    `https://auth.mercadolivre.com.br/authorization?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent('offline_access read write')}` +
    `&state=${encodeURIComponent(state)}`;

  console.log('\naccount   :', acc.label, String(acc._id));
  console.log('clientId  :', clientId);
  console.log('redirect  :', redirectUri);
  console.log('\n=== ABRA ESTA URL E AUTORIZE ===\n');
  console.log(authUrl);
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('failed:', e?.message || e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
