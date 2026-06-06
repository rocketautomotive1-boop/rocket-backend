import { Types } from 'mongoose';
import { encrypt, isEncrypted } from '../../credentials/credentials-crypto.helper';

/**
 * Lógica PURA e idempotente da migração de auth de marketplace
 * (marketplace_accounts/tokens[] → marketplaces.accounts[]). Vive em src/ para
 * ser testável pelo Jest (rootDir=src); o script em scripts/ apenas a orquestra
 * contra o Mongo.
 */

/** Domínio canônico do produto. Corrige o drift histórico 'autoparts' → 'autopecas'. */
export function canonicalDomain(d?: string): string {
  return d === 'autoparts' ? 'autopecas' : (d || 'autopecas');
}

/** Garante ciphertext (enc:v1:...). Já cifrado passa direto; plaintext é cifrado. */
export function ensureEncrypted(value?: string): string | undefined {
  if (!value) return undefined;
  return isEncrypted(value) ? value : encrypt(value);
}

/** clientId/clientSecret do ML a partir do env (seed; nomes legados + MP_*). */
export function mlEnvCredentials(): Record<string, string> {
  const clientId = process.env.MP_MERCADOLIVRE_CLIENTID || process.env.MERCADO_LIVRE_APP_ID;
  const clientSecret =
    process.env.MP_MERCADOLIVRE_CLIENTSECRET ||
    process.env.MERCADO_LIVRE_CLIENT_SECRET ||
    (clientId ? process.env[`MERCADO_LIVRE_CLIENT_SECRET_${clientId}`] : undefined);
  const out: Record<string, string> = {};
  const encId = ensureEncrypted(clientId);
  const encSecret = ensureEncrypted(clientSecret);
  if (encId) out.clientId = encId;
  if (encSecret) out.clientSecret = encSecret;
  return out;
}

export type AccountSnapshot = {
  _id?: Types.ObjectId;
  label: string;
  isDefault: boolean;
  domains: string[];
  credentials: Record<string, string>;
  token?: any;
};

/**
 * Dado o array atual de accounts[], as contas legadas do marketplace, o token
 * legado ativo e a tag, devolve o novo accounts[] consolidado. Idempotente:
 * re-rodar com o mesmo input → mesmo output (match por label, sem duplicar).
 */
export function buildMergedAccounts(args: {
  tag: string;
  currentAccounts: AccountSnapshot[];
  legacyAccounts: any[];
  activeLegacyToken?: any;
  /** true se marketplaces.credentials já tem clientId (não precisa semear do env). */
  marketplaceHasClientId?: boolean;
}): { accounts: AccountSnapshot[]; upserted: number; synthesized: boolean; reconciled: boolean } {
  const { tag, currentAccounts, legacyAccounts, activeLegacyToken } = args;
  const byLabel = new Map<string, AccountSnapshot>((currentAccounts ?? []).map((a) => [a.label, a]));
  let upserted = 0;

  // 1) Backfill a partir de marketplace_accounts (casando por label, $set).
  for (const la of legacyAccounts ?? []) {
    const snapshot: AccountSnapshot = {
      label: la.label,
      isDefault: !!la.isDefault,
      domains: (la.domains ?? []).map(canonicalDomain),
      credentials: Object.fromEntries(
        Object.entries(la.credentials ?? {}).map(([k, v]) => [k, ensureEncrypted(String(v)) as string]),
      ),
      token: la.token ?? undefined,
    };
    byLabel.set(snapshot.label, { ...(byLabel.get(snapshot.label) ?? {}), ...snapshot });
    upserted++;
  }

  // 2) Conta autopeças (isDefault) a partir do token legado, se não houver default.
  //    credentials: {} → resolve via marketplaces.credentials (já cifrado) / env.
  let synthesized = false;
  if (![...byLabel.values()].some((a) => a.isDefault)) {
    byLabel.set('autopecas-default', {
      label: 'autopecas-default',
      isDefault: true,
      domains: ['autopecas'],
      credentials: tag === 'mercadolivre' && !args.marketplaceHasClientId ? mlEnvCredentials() : {},
      token: activeLegacyToken
        ? {
            accessToken: activeLegacyToken.accessToken,
            refreshToken: activeLegacyToken.refreshToken,
            expiresAt: activeLegacyToken.expiresAt,
            tokenType: activeLegacyToken.tokenType,
            additionalData: activeLegacyToken.additionalData ?? {},
            isActive: true,
          }
        : undefined,
    });
    synthesized = true;
  }

  // 3) Reconcilia: no máx. 1 isDefault (mantém a de domínio 'autopecas'; senão a 1ª).
  let merged = [...byLabel.values()];
  const defaults = merged.filter((a) => a.isDefault);
  let reconciled = false;
  if (defaults.length > 1) {
    const keep = defaults.find((a) => a.domains.includes('autopecas')) ?? defaults[0];
    merged = merged.map((a) => (a === keep ? a : { ...a, isDefault: false }));
    reconciled = true;
  }

  return { accounts: merged, upserted, synthesized, reconciled };
}
