import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const VERSION = 'v1';
const PREFIX = 'enc';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MP_CRYPTO_KEY;
  if (!raw) {
    throw new Error(
      'MP_CRYPTO_KEY ausente no .env — necessária para criptografar credenciais de marketplace (AES-256-GCM).',
    );
  }
  cachedKey = scryptSync(raw, 'marketplace-credentials', KEY_LENGTH);
  return cachedKey;
}

export function isEncrypted(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:${VERSION}:`);
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string): string {
  if (!isEncrypted(payload)) {
    throw new Error('Credencial não está criptografada no formato esperado (enc:v1:...).');
  }
  const [, , ivB64, tagB64, ctB64] = payload.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
