// backend/src/marketplace/auth/services/marketplace-account.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { MarketplaceAccountRepository } from './marketplace-account.repository';
import { MarketplaceAccountModel } from '../schemas/marketplace-account.schema';
import { encrypt, decrypt, isEncrypted } from './credentials-crypto.helper';
import { MercadoLivreAuthAdapter } from '../../adapters/mercado-livre/mercado-livre-auth.adapter';

interface RegisterAccountInput {
  marketplaceId: string;
  label: string;
  domains: string[];
  credentials?: Record<string, string>;
}

/**
 * Resolução, cadastro e ciclo OAuth por conta (multi-client).
 * accountFor: conta do domínio → fallback à default. registerAccount: criptografa
 * credentials. saveAccountToken/refreshAccountToken: token POR CONTA, caminho
 * paralelo ao legado (autopeças). Lock de refresh por accountId.
 */
@Injectable()
export class MarketplaceAccountService {
  private readonly refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: MarketplaceAccountRepository,
    private readonly mlAdapter: MercadoLivreAuthAdapter,
  ) {}

  async accountFor(marketplaceId: string, domain: string): Promise<MarketplaceAccountModel | null> {
    const byDomain = await this.repo.findByDomain(marketplaceId, domain);
    if (byDomain) return byDomain;
    return this.repo.findDefault(marketplaceId);
  }

  async registerAccount(input: RegisterAccountInput): Promise<MarketplaceAccountModel> {
    if (!input.label?.trim()) throw new BadRequestException('label da conta é obrigatório.');
    if (!input.domains?.length) throw new BadRequestException('domains da conta é obrigatório.');

    const credentials = this.encryptCredentials(input.credentials ?? {});
    return this.repo.createAccount({
      marketplaceId: input.marketplaceId as any,
      label: input.label,
      domains: input.domains,
      credentials,
    });
  }

  /** Gera a URL de autorização OAuth para a conta (usa o clientId da conta). */
  async buildAuthUrl(accountId: string, redirectUri: string): Promise<{ authUrl: string }> {
    const account = await this.repo.findById(accountId);
    if (!account) throw new BadRequestException(`Conta ${accountId} não encontrada.`);
    const clientId = this.readCredential(account.credentials, 'clientId');
    return this.mlAdapter.generateAuthUrlForAccount(clientId, redirectUri);
  }

  /** Troca o code por token (credenciais da conta) e persiste na conta. */
  async handleAuthCallback(accountId: string, code: string, redirectUri: string): Promise<void> {
    const account = await this.repo.findById(accountId);
    if (!account) throw new BadRequestException(`Conta ${accountId} não encontrada.`);
    const clientId = this.readCredential(account.credentials, 'clientId');
    const clientSecret = this.readCredential(account.credentials, 'clientSecret');
    const tokenData = await this.mlAdapter.authenticateForAccount(code, clientId, clientSecret, redirectUri);
    await this.saveAccountToken(accountId, tokenData);
  }

  /** Persiste o token OAuth de uma conta (idempotente). */
  async saveAccountToken(accountId: string, tokenData: Record<string, any>): Promise<void> {
    await this.repo.updateToken(accountId, { ...tokenData, isActive: true });
  }

  /**
   * Retorna um token válido da conta, renovando se estiver expirando (buffer 30min).
   * Usado pelo endpoint interno que serve o orchestrator (publish multi-conta).
   */
  async ensureValidAccountToken(accountId: string, bufferMinutes = 30): Promise<Record<string, any>> {
    const account = await this.repo.findById(accountId);
    if (!account?.token?.accessToken) {
      throw new BadRequestException(`Conta ${accountId} não possui token ativo.`);
    }
    if (this.isExpiringSoon(account.token, bufferMinutes)) {
      await this.refreshAccountToken(accountId);
      const refreshed = await this.repo.findById(accountId);
      return (refreshed?.token ?? account.token) as Record<string, any>;
    }
    return account.token as Record<string, any>;
  }

  private isExpiringSoon(token: any, bufferMinutes: number): boolean {
    if (!token?.expiresAt) return false;
    const bufferMs = bufferMinutes * 60 * 1000;
    return new Date(token.expiresAt).getTime() - Date.now() < bufferMs;
  }

  /** Renova o token de uma conta usando as credenciais dela. Lock por accountId. */
  async refreshAccountToken(accountId: string): Promise<void> {
    const inFlight = this.refreshLocks.get(accountId);
    if (inFlight) return inFlight;

    const promise = this.doRefreshAccountToken(accountId).finally(() => this.refreshLocks.delete(accountId));
    this.refreshLocks.set(accountId, promise);
    return promise;
  }

  /**
   * Refresh proativo de contas com token expirando (cron). Não derruba o lote
   * se uma conta falhar — conta só os sucessos. Caminho paralelo ao legado.
   */
  async refreshExpiringAccountTokens(bufferMinutes = 30): Promise<number> {
    const before = new Date(Date.now() + bufferMinutes * 60 * 1000);
    const accounts = await this.repo.findExpiringTokenAccounts(before);
    let refreshed = 0;
    for (const acc of accounts) {
      try {
        await this.refreshAccountToken(String((acc as any)._id));
        refreshed++;
      } catch (err: any) {
        // não derruba o lote; log fica a cargo do caller/scheduler
      }
    }
    return refreshed;
  }

  private async doRefreshAccountToken(accountId: string): Promise<void> {
    const account = await this.repo.findById(accountId);
    if (!account?.token?.refreshToken) {
      throw new BadRequestException(`Conta ${accountId} não possui refreshToken ativo.`);
    }
    const clientId = this.readCredential(account.credentials, 'clientId');
    const clientSecret = this.readCredential(account.credentials, 'clientSecret');
    const newToken = await this.mlAdapter.refreshTokenForAccount(account.token, clientId, clientSecret);
    await this.saveAccountToken(accountId, newToken);
  }

  private readCredential(creds: Record<string, string> | undefined, key: string): string {
    const v = creds?.[key];
    if (!v) throw new BadRequestException(`Credencial '${key}' ausente na conta.`);
    return isEncrypted(v) ? decrypt(v) : v;
  }

  private encryptCredentials(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v) out[k] = encrypt(v);
    }
    return out;
  }
}
