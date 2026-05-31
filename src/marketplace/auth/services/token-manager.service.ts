import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, TokenStrategy } from '../../schemas/marketplace.schema';
import { MarketplaceAccountRepository } from './marketplace-account.repository';

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
        private readonly accountRepo: MarketplaceAccountRepository,
    ) { }

    /**
     * Resolve o token para um marketplace conforme sua estratégia configurada.
     * Nunca lança erro por "token não encontrado" para estratégias que não usam DB.
     */
    async resolveToken(marketplaceId: string): Promise<ResolvedToken> {
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
                return this.resolveHybridToken(marketplace);

            case 'oauth2':
            default:
                return this.resolveOAuthToken(marketplace);
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
    private resolveHybridToken(marketplace: MarketplaceDocument): ResolvedToken {
        const awsBase = this.resolveAwsCredentials(marketplace);

        const activeToken = marketplace.tokens?.find(t => t.isActive);

        if (!activeToken) {
            this.logger.warn(
                `${marketplace.name}: nenhum token LWA ativo no DB. ` +
                `Operações que exigem LWA (ex: listagem de pedidos PII) vão falhar. ` +
                `Complete o fluxo OAuth em /auth/${marketplace.tag}/url`
            );
        }

        return {
            accessToken: activeToken?.accessToken ?? null,
            refreshToken: activeToken?.refreshToken,
            expiresAt: activeToken?.expiresAt,
            strategy: 'hybrid',
            fromDatabase: !!activeToken,
            additionalData: {
                ...awsBase.additionalData,
                ...(activeToken?.additionalData ?? {}),
                sellerId: process.env.AMAZON_SELLER_ID || activeToken?.additionalData?.sellerId,
                marketplaceId: process.env.AMAZON_MARKETPLACE_ID,
            },
        };
    }

    private async resolveOAuthToken(marketplace: MarketplaceDocument): Promise<ResolvedToken> {
        // Preferir a conta default (multi-client). Fallback ao token legado em tokens[].
        const account = await this.accountRepo.findDefault(String(marketplace._id));
        const accountToken = account?.token;
        const activeToken = (accountToken?.isActive ? accountToken : null)
            ?? marketplace.tokens?.find(t => t.isActive);

        if (!activeToken) {
            throw new Error(
                `Nenhum token OAuth ativo para ${marketplace.name}. ` +
                `Complete a autenticação em /auth/${marketplace.tag ?? marketplace.name}/url`
            );
        }

        return {
            accessToken: activeToken.accessToken,
            refreshToken: activeToken.refreshToken,
            expiresAt: activeToken.expiresAt,
            strategy: 'oauth2',
            fromDatabase: true,
            additionalData: activeToken.additionalData ?? {},
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
