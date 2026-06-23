import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

/** Emitido após persistir um token. O TokenRefreshScheduler ouve para (re)agendar o refresh proativo. */
export const TOKEN_SAVED_EVENT = 'marketplace.token.saved';

export interface TokenSavedEvent {
  marketplaceId: string;
  accountId: string;
  expiresAt?: Date | null;
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Resolução de conta ─────────────────────────────────────────────────────

  /**
   * Conta de SAÍDA (publicação) do marketplace: a CONTA ATIVA selecionada na
   * tela (`marketplace.activeAccountId`), independente do domínio do produto.
   *  - activeAccountId aponta uma conta existente → publica com ela.
   *  - sem conta ativa (null/ausente) → fallback isDefault → 1ª conta (preserva
   *    marketplaces ainda não migrados; uma vez setado, activeAccountId manda).
   *
   * `domain` é mantido na assinatura por compat com os chamadores, mas NÃO entra
   * mais na seleção (o modelo deixou de rotear por domínio).
   */
  async accountFor(marketplaceId: string, domain?: string): Promise<AccountRef | null> {
    void domain; // não roteia mais por domínio — conta ativa decide.
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return null;
    const accounts: (MarketplaceAccountSnapshot & { _id?: any })[] = (mp as any).accounts ?? [];
    if (accounts.length === 0) return null;

    const activeId: string | null = (mp as any).activeAccountId ?? null;
    if (activeId) {
      const active = accounts.find((a) => String(a._id) === String(activeId));
      if (active) return this.toRef(marketplaceId, (mp as any).tag, active);
      // conta ativa foi removida → cai no fallback.
    }

    const chosen = accounts.find((a) => a.isDefault) ?? accounts[0];
    return chosen ? this.toRef(marketplaceId, (mp as any).tag, chosen) : null;
  }

  /**
   * Define a CONTA ATIVA de publicação do marketplace (radio na tela). `null`
   * limpa (marketplace deixa de publicar). Valida que a conta existe e está
   * autorizada (tem token) — não faz sentido ativar uma conta sem token.
   */
  async setActiveAccount(marketplaceId: string, accountId: string | null): Promise<{ activeAccountId: string | null }> {
    const mp = await this.marketplaceModel.findById(marketplaceId).exec();
    if (!mp) throw new BadRequestException(`Marketplace ${marketplaceId} não encontrado.`);

    if (accountId !== null) {
      const account = ((mp as any).accounts ?? []).find((a: any) => String(a._id) === String(accountId));
      if (!account) throw new BadRequestException(`Conta ${accountId} não existe no marketplace ${marketplaceId}.`);
      if (!account?.token?.accessToken) {
        throw new BadRequestException('Não é possível ativar uma conta ainda não autorizada. Autorize primeiro.');
      }
    }

    (mp as any).activeAccountId = accountId;
    mp.markModified('activeAccountId');
    await mp.save();
    // activeAccountId é config cacheada → invalidar.
    this.configCache.invalidate();
    return { activeAccountId: accountId };
  }

  /**
   * Lista as contas de um marketplace para a tela de Configurações: id, label,
   * isDefault e o STATUS do token (sem expor secret/accessToken). Usado pelo
   * controller de administração das contas multi-client.
   */
  async listAccounts(marketplaceId: string): Promise<{
    accounts: Array<{
      accountId: string;
      label: string;
      displayName: string | null;
      isActive: boolean;
      hasToken: boolean;
      tokenExpiresAt: Date | null;
      externalUserId: string | null;
    }>;
    activeAccountId: string | null;
  }> {
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) throw new BadRequestException(`Marketplace ${marketplaceId} não encontrado.`);
    const accounts: any[] = (mp as any).accounts ?? [];
    const activeAccountId: string | null = (mp as any).activeAccountId ?? null;
    return {
      accounts: accounts.map((a) => ({
        accountId: String(a._id),
        label: a.label,
        // Nome real da conta no marketplace (ex.: nickname do ML via /users/me),
        // persistido em additionalData no authorize. Fallback null → UI usa label.
        displayName: a?.token?.additionalData?.nickname
          ? String(a.token.additionalData.nickname)
          : null,
        isActive: String(a._id) === String(activeAccountId),
        hasToken: !!a?.token?.accessToken,
        tokenExpiresAt: a?.token?.expiresAt ?? null,
        externalUserId: a?.token?.additionalData?.userId
          ? String(a.token.additionalData.userId)
          : null,
      })),
      activeAccountId,
    };
  }

  /**
   * true se o marketplace NÃO deve publicar: tem contas cadastradas, mas nenhuma
   * conta ativa válida selecionada. Distingue "publicação desligada de propósito"
   * de "falha de token", para o caminho de saída PULAR (não é erro).
   * Sem contas → false (deixa o fluxo seguir e falhar como antes, não é o caso
   * de "desligado pelo usuário").
   */
  async isPublishingDisabled(marketplaceId: string): Promise<boolean> {
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return false;
    const accounts: any[] = (mp as any).accounts ?? [];
    if (accounts.length === 0) return false;
    const activeId: string | null = (mp as any).activeAccountId ?? null;
    if (!activeId) return true; // contas existem mas nenhuma ativa → desligado.
    const active = accounts.find((a) => String(a._id) === String(activeId));
    return !active?.token?.accessToken; // ativa removida/sem token → desligado.
  }

  /**
   * Remove uma conta de accounts[]. Se a conta removida era a ATIVA, limpa
   * `activeAccountId` (o marketplace deixa de publicar até você ativar outra).
   */
  async deleteAccount(marketplaceId: string, accountId: string): Promise<void> {
    const mp = await this.marketplaceModel.findById(marketplaceId).exec();
    if (!mp) throw new BadRequestException(`Marketplace ${marketplaceId} não encontrado.`);
    const accounts: any[] = (mp as any).accounts ?? [];
    const target = accounts.find((a) => String(a._id) === String(accountId));
    if (!target) throw new BadRequestException(`Conta ${accountId} não encontrada.`);

    (mp as any).accounts = accounts.filter((a) => String(a._id) !== String(accountId));
    if (String((mp as any).activeAccountId) === String(accountId)) {
      (mp as any).activeAccountId = null;
      mp.markModified('activeAccountId');
    }
    mp.markModified('accounts');
    await mp.save();
    this.configCache.invalidate();
  }

  /** Resolve uma conta multi-client pelo accountId (público — usado por forceRefresh por conta). */
  async accountById(marketplaceId: string, accountId: string): Promise<AccountRef | null> {
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return null;
    const acc = ((mp as any).accounts ?? []).find((a: any) => String(a._id) === String(accountId));
    return acc ? this.toRef(marketplaceId, (mp as any).tag, acc) : null;
  }

  /**
   * Contas (id + label) com token OAuth ativo de um marketplace. Usado pelo
   * reconciler para varrer cada conta multi-client com seu próprio cursor.
   * Devolve [] quando não há accounts[] (marketplace single-client legado) — o
   * chamador trata o caso default sem accountId.
   */
  async listAccountsWithToken(marketplaceId: string): Promise<Array<{ accountId: string; label: string }>> {
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return [];
    const accounts: any[] = (mp as any).accounts ?? [];
    return accounts
      .filter((a) => a?.token?.accessToken)
      .map((a) => ({ accountId: String(a._id), label: a.label }));
  }

  /**
   * Conta cujo token foi emitido para `externalUserId` (o id do seller NO
   * marketplace, ex.: ML `user_id`). É a resolução de ENTRADA (webhook/order):
   * o marketplace nos diz a conta destino; não escolhemos por domínio.
   * Match em `token.additionalData.userId`. Devolve null se nenhuma conta casar
   * — o chamador NÃO deve cair na conta default (roteamento errado de pedido).
   */
  async resolveAccountByExternalUserId(
    marketplaceId: string,
    externalUserId: string | number,
  ): Promise<AccountRef | null> {
    const target = String(externalUserId);
    const mp = await this.marketplaceModel.findById(marketplaceId).lean().exec();
    if (!mp) return null;
    const accounts: any[] = (mp as any).accounts ?? [];
    const acc = accounts.find(
      (a) => String(a?.token?.additionalData?.userId ?? '') === target,
    );
    return acc ? this.toRef(marketplaceId, (mp as any).tag, acc) : null;
  }

  /**
   * Token válido de uma conta ESPECÍFICA (por accountId), renovando se estiver
   * expirando. Caminho de entrada (orders): a conta já está determinada pelo
   * webhook, não há escolha por domínio. Lança se a conta/token não existir.
   */
  async ensureValidTokenByAccount(
    marketplaceId: string,
    accountId: string,
  ): Promise<ResolvedAccountToken> {
    const account = await this.accountById(marketplaceId, accountId);
    if (!account?.token?.accessToken) {
      throw new BadRequestException(
        `Nenhum token OAuth ativo para conta ${accountId} (marketplace ${marketplaceId}).`,
      );
    }
    if (this.isExpiringSoon(account.token, 30) && account.token.refreshToken) {
      await this.refreshToken(marketplaceId, accountId);
      const refreshed = await this.accountById(marketplaceId, accountId);
      if (refreshed?.token?.accessToken) return this.shape(refreshed.token);
    }
    return this.shape(account.token);
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

  /**
   * Tokens renováveis de todos os accounts[] habilitados, com seu expiresAt.
   * Usado pelo TokenRefreshScheduler para rehidratar os timers no boot (um por
   * token). Pula tokens sem refreshToken — não há como renová-los proativamente.
   */
  async listSchedulableTokens(): Promise<Array<{ marketplaceId: string; accountId: string; expiresAt?: Date | null }>> {
    const marketplaces = await this.marketplaceModel.find({ enabled: true }).lean().exec();
    const out: Array<{ marketplaceId: string; accountId: string; expiresAt?: Date | null }> = [];
    for (const mp of marketplaces) {
      const accounts: any[] = (mp as any).accounts ?? [];
      for (const acc of accounts) {
        if (!acc?.token?.refreshToken) continue;
        out.push({
          marketplaceId: String((mp as any)._id),
          accountId: String(acc._id),
          expiresAt: acc.token.expiresAt ?? null,
        });
      }
    }
    return out;
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
    // (Re)agenda o refresh proativo a partir do novo expiresAt. Único ponto de
    // escrita de token → cobre refresh, callback OAuth e registro de conta.
    this.eventEmitter.emit(TOKEN_SAVED_EVENT, {
      marketplaceId: account.marketplaceId,
      accountId: account.accountId,
      expiresAt: token.expiresAt ?? null,
    } as TokenSavedEvent);
  }

  // ── Registro de conta (admin) ──────────────────────────────────────────────

  /**
   * Cria uma conta em accounts[] com credenciais cifradas. Enforça label único
   * por marketplace. `domains` é legado/opcional (o modelo publica pela conta
   * ATIVA, não por domínio). Retorna o accountId criado.
   */
  async registerAccount(input: {
    marketplaceId: string;
    label: string;
    domains?: string[];
    credentials: Record<string, string>;
  }): Promise<{ accountId: string; label: string }> {
    if (!input.label?.trim()) throw new BadRequestException('label da conta é obrigatório.');

    const mp = await this.marketplaceModel.findById(input.marketplaceId).exec();
    if (!mp) throw new BadRequestException(`Marketplace ${input.marketplaceId} não encontrado.`);

    const accounts: any[] = (mp as any).accounts ?? [];
    if (accounts.some((a) => a.label === input.label)) {
      throw new BadRequestException(`Já existe conta com label '${input.label}' neste marketplace.`);
    }

    const account: any = {
      _id: new Types.ObjectId(),
      label: input.label,
      isDefault: false,
      domains: (input.domains ?? []).map(canonicalDomain),
      credentials: this.encryptCredentials(input.credentials),
      token: undefined,
    };
    (mp as any).accounts = [...accounts, account];
    await mp.save();
    // accounts[] é config cacheada → invalidar.
    this.configCache.invalidate();
    return { accountId: String(account._id), label: account.label };
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
    await this.saveAccountToken(located, await this.enrichWithProfile(adapter, tokenData));
  }

  /**
   * Enriquece o token com o PERFIL da conta (nome real) quando o adapter suporta
   * `fetchAccountProfile`. Best-effort: falha não bloqueia a persistência do token.
   */
  private async enrichWithProfile(adapter: any, tokenData: any): Promise<any> {
    if (typeof adapter?.fetchAccountProfile !== 'function') return tokenData;
    try {
      const profile = await adapter.fetchAccountProfile(tokenData);
      if (profile?.nickname) {
        return {
          ...tokenData,
          additionalData: { ...(tokenData.additionalData ?? {}), nickname: profile.nickname },
        };
      }
    } catch {
      /* best-effort — segue sem nickname */
    }
    return tokenData;
  }

  /**
   * Backfill do nome real de uma conta JÁ autorizada: re-busca o perfil com o
   * token salvo e persiste `nickname`. Usado pelo endpoint de refresh de perfil
   * (contas autorizadas antes desta feature não têm nickname salvo).
   */
  async refreshAccountProfile(accountId: string): Promise<{ nickname: string | null }> {
    const account = await this.locateAccount(accountId);
    if (!account) throw new BadRequestException(`Conta ${accountId} não encontrada.`);
    if (!account.token?.accessToken) {
      throw new BadRequestException('Conta sem token ativo — autorize antes de atualizar o perfil.');
    }
    const adapter: any = this.registry.getAuthAdapter(account.tag);
    if (typeof adapter?.fetchAccountProfile !== 'function') return { nickname: null };

    const profile = await adapter.fetchAccountProfile(account.token);
    if (!profile?.nickname) return { nickname: null };

    const enriched = {
      ...account.token,
      additionalData: { ...(account.token.additionalData ?? {}), nickname: profile.nickname },
    };
    await this.saveAccountToken(account, enriched);
    return { nickname: profile.nickname };
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
