import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, MarketplaceAccountSnapshot } from '../../schemas/marketplace.schema';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { decrypt, encrypt, isEncrypted } from '../../credentials/credentials-crypto.helper';
import { MarketplaceConfigCacheService } from '../../services/marketplace-config-cache.service';

/** Token resolvido para uma conta (forma consumida pelo TokenManager/endpoints internos). */
export interface ResolvedAccountToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  additionalData: Record<string, any>;
}

/** Referência leve à conta resolvida dentro do marketplace. */
interface AccountRef {
  marketplaceId: string;
  tag: string;
  accountId: string;
  label: string;
  domains: string[];
  credentials: Record<string, string>;
  token?: any;
}

/** Domínio canônico do produto. Corrige o drift histórico 'autoparts' → 'autopecas'. */
export function canonicalDomain(domain?: string): string {
  return domain === 'autoparts' ? 'autopecas' : (domain || 'autopecas');
}

/**
 * Fonte ÚNICA de resolução/ciclo de vida de token OAuth de marketplace
 * (multi-client por domínio). Implementação `oauth2` para a qual o
 * TokenManagerService delega.
 *
 * Modelo de dados único: `marketplaces.accounts[]`. NÃO há fallback a
 * tokens[]/marketplace_accounts — a migração (migrate-accounts-into-marketplaces)
 * popula accounts[] e DEVE rodar antes do deploy.
 *
 * Um único lock de refresh por accountId. Invariantes (1 default, label único)
 * garantidas em nível de aplicação no save/registro.
 */
@Injectable()
export class MarketplaceTokenBrokerService {
  private readonly logger = new Logger(MarketplaceTokenBrokerService.name);
  private readonly refreshLocks = new Map<string, Promise<void>>();

  constructor(
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    private readonly credentials: MarketplaceCredentialsService,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  // ── Resolução de conta ─────────────────────────────────────────────────────

  /** Conta que atende o domínio: match exato (normalizado) → fallback isDefault → 1ª. */
  async accountFor(marketplaceId: string, domain?: string): Promise<AccountRef | null> {
    const dom = canonicalDomain(domain);
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return null;
    const accounts: (MarketplaceAccountSnapshot & { _id?: any })[] = (mp as any).accounts ?? [];
    if (accounts.length === 0) return null;

    const chosen =
      accounts.find((a) => (a.domains ?? []).map(canonicalDomain).includes(dom)) ??
      accounts.find((a) => a.isDefault) ??
      accounts[0];
    return chosen ? this.toRef(marketplaceId, (mp as any).tag, chosen) : null;
  }

  private async accountById(marketplaceId: string, accountId: string): Promise<AccountRef | null> {
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return null;
    const acc = ((mp as any).accounts ?? []).find((a: any) => String(a._id) === String(accountId));
    return acc ? this.toRef(marketplaceId, (mp as any).tag, acc) : null;
  }

  private toRef(
    marketplaceId: string,
    tag: string,
    account: MarketplaceAccountSnapshot & { _id?: any },
  ): AccountRef {
    return {
      marketplaceId,
      tag,
      accountId: String(account._id),
      label: account.label,
      domains: (account.domains ?? []).map(canonicalDomain),
      credentials: account.credentials ?? {},
      token: account.token,
    };
  }

  // ── Token: leitura + renovação ─────────────────────────────────────────────

  /**
   * ÚNICA entrada de token OAuth: resolve a conta do domínio, renova se estiver
   * expirando (buffer 30min) e devolve o accessToken válido + additionalData.
   */
  async ensureValidToken(marketplaceId: string, domain?: string): Promise<ResolvedAccountToken> {
    const account = await this.accountFor(marketplaceId, domain);
    if (!account?.token?.accessToken) {
      throw new BadRequestException(
        `Nenhum token OAuth ativo para marketplace ${marketplaceId} (domínio ${canonicalDomain(domain)}).`,
      );
    }

    if (this.isExpiringSoon(account.token, 30) && account.token.refreshToken) {
      await this.refreshToken(marketplaceId, account.accountId, domain);
      const refreshed = await this.accountFor(marketplaceId, domain);
      if (refreshed?.token?.accessToken) return this.shape(refreshed.token);
    }

    return this.shape(account.token);
  }

  private shape(token: any): ResolvedAccountToken {
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      tokenType: token.tokenType,
      additionalData: token.additionalData ?? {},
    };
  }

  isExpiringSoon(token: any, bufferMinutes = 30): boolean {
    if (!token?.expiresAt) return false;
    return new Date(token.expiresAt).getTime() - Date.now() < bufferMinutes * 60 * 1000;
  }

  /** Renova o token de uma conta (1 lock por accountId). */
  async refreshToken(marketplaceId: string, accountId: string, domain?: string): Promise<void> {
    const key = `${marketplaceId}:${accountId}`;
    const inFlight = this.refreshLocks.get(key);
    if (inFlight) return inFlight;
    const promise = this.doRefresh(marketplaceId, accountId, domain).finally(() => this.refreshLocks.delete(key));
    this.refreshLocks.set(key, promise);
    return promise;
  }

  private async doRefresh(marketplaceId: string, accountId: string, domain?: string): Promise<void> {
    const account = (await this.accountById(marketplaceId, accountId)) ?? (await this.accountFor(marketplaceId, domain));
    if (!account?.token?.refreshToken) {
      throw new BadRequestException(`Conta ${accountId} sem refreshToken ativo.`);
    }
    const { clientId, clientSecret } = await this.resolveCredentials(account);
    const adapter = this.registry.getAuthAdapter(account.tag);
    const newToken = await adapter.refreshToken(account.token, { clientId, clientSecret });
    await this.saveAccountToken(account, newToken);
  }

  /** Refresh proativo (scheduler): renova tokens expirando em todos os accounts[]. */
  async refreshExpiringTokens(bufferMinutes = 30): Promise<number> {
    const marketplaces = await this.marketplaceModel.find({ enabled: true }).lean().exec();
    let refreshed = 0;
    for (const mp of marketplaces) {
      const accounts: any[] = (mp as any).accounts ?? [];
      for (const acc of accounts) {
        if (!acc?.token?.refreshToken) continue;
        if (!this.isExpiringSoon(acc.token, bufferMinutes)) continue;
        try {
          await this.refreshToken(String((mp as any)._id), String(acc._id), (acc.domains ?? [])[0]);
          refreshed++;
        } catch (err: any) {
          this.logger.warn(`refreshExpiringTokens: conta ${acc.label} falhou: ${err?.message}`);
        }
      }
    }
    return refreshed;
  }

  // ── Token: escrita ─────────────────────────────────────────────────────────

  /**
   * Persiste o token na conta que atende o domínio (default se omitido). Usado
   * pelo fluxo OAuth genérico (/auth/:tag/callback) onde só temos marketplaceId.
   */
  async saveTokenForDomain(marketplaceId: string, domain: string | undefined, tokenData: any): Promise<void> {
    const account = await this.accountFor(marketplaceId, domain);
    if (!account) {
      throw new BadRequestException(
        `Nenhuma conta em accounts[] para marketplace ${marketplaceId} (domínio ${canonicalDomain(domain)}). Rode a migração/registre a conta antes.`,
      );
    }
    await this.saveAccountToken(account, tokenData);
  }

  /** Credenciais (plaintext) da conta do domínio — para o adapter no fluxo genérico. */
  async credentialsForDomain(marketplaceId: string, domain?: string): Promise<{ clientId?: string; clientSecret?: string }> {
    const account = await this.accountFor(marketplaceId, domain);
    if (!account) return {};
    return this.resolveCredentials(account);
  }

  /**
   * Segredo de assinatura (partnerKey/appSecret/awsSecretKey…) da conta que
   * atende o domínio. Mesmo fallback de `resolveCredentials`: override cifrado na
   * conta → `marketplaces.credentials` → env (MP_<TAG>_<KEY>). Aceita tag OU id.
   * Sem conta em accounts[], cai direto na credencial do marketplace (preserva o
   * comportamento de marketplaces ainda não migrados ao modelo multi-client).
   */
  async signingCredentialForDomain(
    tagOrId: string,
    domain: string | undefined,
    key: string,
  ): Promise<string | undefined> {
    const marketplaceId = await this.resolveMarketplaceId(tagOrId);
    if (!marketplaceId) return this.credentials.get(tagOrId, key);

    const account = await this.accountFor(marketplaceId, domain);
    if (!account) return this.credentials.get(marketplaceId, key);
    return this.resolveCredentialKey(account, key);
  }

  /** Resolve tagOrId → marketplaceId (ObjectId string). Devolve null se não achar. */
  private async resolveMarketplaceId(tagOrId: string): Promise<string | null> {
    // Config estável (id/tag/name) servida do cache in-process — antes batia no
    // Mongo a cada chamada (milhares/dia). Token não passa por aqui.
    return this.configCache.resolveId(tagOrId);
  }

  /** Persiste (substitui) o token de uma conta em accounts[]. */
  async saveAccountToken(account: AccountRef, tokenData: any): Promise<void> {
    const token = { ...tokenData, isActive: true };
    await this.marketplaceModel.updateOne(
      { _id: new Types.ObjectId(account.marketplaceId) },
      { $set: { 'accounts.$[a].token': token } },
      { arrayFilters: [{ 'a._id': new Types.ObjectId(account.accountId) }] } as any,
    ).exec();
  }

  // ── Registro de conta (admin) ──────────────────────────────────────────────

  /**
   * Cria uma conta em accounts[] com credenciais cifradas. Enforça invariantes:
   * label único por marketplace; no máx. 1 isDefault. Retorna o accountId criado.
   */
  async registerAccount(input: {
    marketplaceId: string;
    label: string;
    domains: string[];
    credentials: Record<string, string>;
    isDefault?: boolean;
  }): Promise<{ accountId: string; label: string; domains: string[] }> {
    if (!input.label?.trim()) throw new BadRequestException('label da conta é obrigatório.');
    if (!input.domains?.length) throw new BadRequestException('domains da conta é obrigatório.');

    const mp = await this.marketplaceModel.findById(input.marketplaceId).exec();
    if (!mp) throw new BadRequestException(`Marketplace ${input.marketplaceId} não encontrado.`);

    const accounts: any[] = (mp as any).accounts ?? [];
    if (accounts.some((a) => a.label === input.label)) {
      throw new BadRequestException(`Já existe conta com label '${input.label}' neste marketplace.`);
    }

    const isDefault = !!input.isDefault && !accounts.some((a) => a.isDefault);
    const account: any = {
      _id: new Types.ObjectId(),
      label: input.label,
      isDefault,
      domains: input.domains.map(canonicalDomain),
      credentials: this.encryptCredentials(input.credentials),
      token: undefined,
    };
    (mp as any).accounts = [...accounts, account];
    await mp.save();
    // accounts[].label/domains/credentials são config cacheada → invalidar.
    this.configCache.invalidate();
    return { accountId: String(account._id), label: account.label, domains: account.domains };
  }

  private encryptCredentials(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (v) out[k] = isEncrypted(v) ? v : encrypt(v);
    }
    return out;
  }

  // ── OAuth: authUrl + callback ──────────────────────────────────────────────

  /** Gera a authUrl usando o clientId da conta (state = accountId). */
  async buildAuthUrl(accountId: string, redirectUri: string): Promise<{ authUrl: string }> {
    const account = await this.locateAccount(accountId);
    if (!account) throw new BadRequestException(`Conta ${accountId} não encontrada.`);
    const { clientId, clientSecret } = await this.resolveCredentials(account);
    const adapter = this.registry.getAuthAdapter(account.tag);
    return adapter.generateAuthUrl(redirectUri, { state: accountId, credentials: { clientId, clientSecret } });
  }

  /**
   * Troca o code por token e persiste. `accountId` vem do `state` do OAuth.
   * Resolve o marketplace a partir da conta (varre todos os marketplaces).
   */
  async handleAuthCallback(accountId: string, code: string, redirectUri: string): Promise<void> {
    const located = await this.locateAccount(accountId);
    if (!located) throw new BadRequestException(`Conta ${accountId} não encontrada.`);
    const { clientId, clientSecret } = await this.resolveCredentials(located);
    const adapter = this.registry.getAuthAdapter(located.tag);
    const tokenData = await adapter.authenticate(code, { redirectUri, credentials: { clientId, clientSecret } });
    await this.saveAccountToken(located, tokenData);
  }

  /** Localiza uma conta por accountId em qualquer marketplace. */
  private async locateAccount(accountId: string): Promise<AccountRef | null> {
    if (!Types.ObjectId.isValid(accountId)) return null;
    const mp = await this.marketplaceModel
      .findOne({ 'accounts._id': new Types.ObjectId(accountId) })
      .lean()
      .exec();
    if (!mp) return null;
    const acc = ((mp as any).accounts ?? []).find((a: any) => String(a._id) === String(accountId));
    return acc ? this.toRef(String((mp as any)._id), (mp as any).tag, acc) : null;
  }

  // ── Credenciais ────────────────────────────────────────────────────────────

  /**
   * Resolve clientId/clientSecret da conta: overrides cifrados na conta →
   * fallback ao MarketplaceCredentialsService (marketplaces.credentials + env).
   * Não lança se ausentes — alguns providers (ex.: Shopee/partnerKey) não usam
   * clientId/secret OAuth; o adapter decide o que é obrigatório.
   */
  private async resolveCredentials(account: AccountRef): Promise<{ clientId?: string; clientSecret?: string }> {
    const clientId = await this.resolveCredentialKey(account, 'clientId');
    const clientSecret = await this.resolveCredentialKey(account, 'clientSecret');
    return { clientId, clientSecret };
  }

  /**
   * Valor (plaintext) de uma credencial da conta para uma `key` arbitrária:
   * override cifrado na conta → `marketplaces.credentials` (por id) → idem por tag/env.
   */
  private async resolveCredentialKey(account: AccountRef, key: string): Promise<string | undefined> {
    const raw = account.credentials?.[key];
    if (raw) return isEncrypted(raw) ? decrypt(raw) : raw;
    return (
      (await this.credentials.get(account.marketplaceId, key)) ??
      (await this.credentials.get(account.tag, key))
    );
  }
}
