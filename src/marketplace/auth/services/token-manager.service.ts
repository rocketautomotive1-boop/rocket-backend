import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, TokenStrategy } from '../../schemas/marketplace.schema';
import { MarketplaceTokenBrokerService } from './marketplace-token-broker.service';

export interface ResolvedToken {
    accessToken: string | null;
    refreshToken?: string;
    expiresAt?: Date;
    additionalData?: Record<string, any>;
    strategy: TokenStrategy;
    /** true = veio do DB, false = veio de env vars */
    fromDatabase: boolean;
}

@Injectable()
export class TokenManagerService {
    private readonly logger = new Logger(TokenManagerService.name);

    constructor(
        @InjectModel(MarketplaceModel.name)
        private readonly marketplaceModel: Model<MarketplaceDocument>,
        private readonly broker: MarketplaceTokenBrokerService,
    ) { }

    /**
     * Resolve o token para um marketplace conforme sua estratégia configurada.
     * Nunca lança erro por "token não encontrado" para estratégias que não usam DB.
     *
     * Seletor de conta (só relevante para oauth2/hybrid — multi-client):
     *  - `accountId` → resolução de ENTRADA (webhook/order): a conta já está
     *    determinada pelo marketplace; tem PRECEDÊNCIA sobre domain.
     *  - `domain` → resolução de SAÍDA (publicação): escolhe a conta pelo domínio
     *    do produto.
     * Aceita string (domain, legado posicional) ou objeto { domain?, accountId? }.
     */
    async resolveToken(
        marketplaceId: string,
        selector?: string | { domain?: string; accountId?: string },
    ): Promise<ResolvedToken> {
        const { domain, accountId } =
            typeof selector === 'string' ? { domain: selector, accountId: undefined } : (selector ?? {});

        const marketplace = await this.marketplaceModel.findById(marketplaceId).exec();
        if (!marketplace) {
            throw new Error(`Marketplace ${marketplaceId} não encontrado`);
        }

        const strategy: TokenStrategy = marketplace.tokenStrategy || 'oauth2';

        switch (strategy) {
            case 'none':
                return { accessToken: null, strategy, fromDatabase: false };

            case 'api_key':
                return this.resolveApiKey(marketplace);

            case 'aws_sigv4':
                return this.resolveAwsCredentials(marketplace);

            case 'hybrid':
                return this.resolveHybridToken(marketplace, domain);

            case 'oauth2':
            default:
                return this.resolveOAuthToken(marketplace, domain, accountId);
        }
    }

    private resolveApiKey(marketplace: MarketplaceDocument): ResolvedToken {
        const apiKey = marketplace.settings?.apiKey;
        if (!apiKey) {
            throw new Error(`api_key não configurada em settings para ${marketplace.name}`);
        }
        return {
            accessToken: apiKey,
            strategy: 'api_key',
            fromDatabase: true,
            additionalData: marketplace.settings,
        };
    }

    private resolveAwsCredentials(marketplace: MarketplaceDocument): ResolvedToken {
        // Não precisa de token no DB — usa apenas env vars
        const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;

        if (!accessKeyId || !secretAccessKey) {
            throw new Error('Credenciais AWS (AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY) não configuradas');
        }

        return {
            accessToken: null, // SigV4 não usa accessToken no header padrão
            strategy: 'aws_sigv4',
            fromDatabase: false,
            additionalData: {
                accessKeyId,
                secretAccessKey,
                region: process.env.AMAZON_AWS_REGION || 'us-east-1',
                endpoint: process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com',
            },
        };
    }

    /**
     * Amazon SP-API: LWA token no DB (opcional) + SigV4 obrigatório via env.
     * Se não há token LWA, retorna null para accessToken mas não lança erro —
     * o adapter decide se precisa do LWA ou pode usar apenas SigV4.
     */
    private async resolveHybridToken(marketplace: MarketplaceDocument, domain?: string): Promise<ResolvedToken> {
        const awsBase = this.resolveAwsCredentials(marketplace);

        // Token LWA (oauth) resolvido pela via única (broker → accounts[]). Pode
        // não existir (Amazon sem LWA) — nesse caso seguimos só com SigV4 (env).
        const activeToken = await this.broker
            .accountFor(String(marketplace._id), domain)
            .then((a) => a?.token)
            .catch(() => undefined);

        if (!activeToken?.accessToken) {
            this.logger.warn(
                `${marketplace.name}: nenhum token LWA ativo. ` +
                `Operações que exigem LWA (ex: listagem de pedidos PII) vão falhar. ` +
                `Complete o fluxo OAuth em /auth/${marketplace.tag}/url`
            );
        }

        return {
            accessToken: activeToken?.accessToken ?? null,
            refreshToken: activeToken?.refreshToken,
            expiresAt: activeToken?.expiresAt,
            strategy: 'hybrid',
            fromDatabase: !!activeToken?.accessToken,
            additionalData: {
                ...awsBase.additionalData,
                ...(activeToken?.additionalData ?? {}),
                sellerId: process.env.AMAZON_SELLER_ID || activeToken?.additionalData?.sellerId,
                marketplaceId: process.env.AMAZON_MARKETPLACE_ID,
            },
        };
    }

    /** Força a renovação do token oauth2 (ignora buffer) e devolve o renovado. */
    async forceRefresh(marketplaceId: string, domain?: string): Promise<ResolvedToken> {
        const account = await this.broker.accountFor(marketplaceId, domain);
        if (account?.accountId) {
            await this.broker.refreshToken(marketplaceId, account.accountId, domain);
        }
        return this.resolveToken(marketplaceId, domain);
    }

    private async resolveOAuthToken(marketplace: MarketplaceDocument, domain?: string, accountId?: string): Promise<ResolvedToken> {
        // Delega ao broker unificado. accountId (entrada/webhook) tem precedência:
        // a conta já está determinada, não se escolhe por domínio.
        const resolved = accountId
            ? await this.broker.ensureValidTokenByAccount(String(marketplace._id), accountId)
            : await this.broker.ensureValidToken(String(marketplace._id), domain);
        return {
            accessToken: resolved.accessToken,
            refreshToken: resolved.refreshToken,
            expiresAt: resolved.expiresAt,
            strategy: 'oauth2',
            fromDatabase: true,
            additionalData: resolved.additionalData ?? {},
        };
    }

    /**
     * Verifica se o token está próximo de expirar e retorna true se precisar de refresh.
     * Só relevante para estratégias que armazenam token no DB.
     */
    isTokenExpiringSoon(token: ResolvedToken, bufferMinutes = 5): boolean {
        if (!token.fromDatabase || !token.expiresAt) return false;
        const bufferMs = bufferMinutes * 60 * 1000;
        return (new Date(token.expiresAt).getTime() - Date.now()) < bufferMs;
    }
}
