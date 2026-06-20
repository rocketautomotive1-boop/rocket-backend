import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { TokenManagerService, ResolvedToken } from './token-manager.service';
import { MarketplaceTokenBrokerService } from './marketplace-token-broker.service';

/**
 * Camada de auth genérica de marketplace (fina). Responsabilidades:
 *  - fluxo OAuth genérico (authenticate/generateAuthUrl) via adapter do provider;
 *  - leitura de token (ensureValidToken) delegando ao TokenManager (oauth2 → broker);
 *  - refresh forçado delegando ao broker.
 *
 * NÃO guarda nem renova token diretamente em tokens[] (legado removido) — o
 * ciclo de vida do token oauth2 vive no MarketplaceTokenBrokerService, sobre
 * marketplaces.accounts[]. Os adapters registram-se no MarketplaceAdapterRegistry
 * (não aqui), então a dependência flui só pra baixo (sem forwardRef de adapter).
 */
@Injectable()
export class MarketplaceAuthService {
    private readonly logger = new Logger(MarketplaceAuthService.name);

    constructor(
        private registryService: MarketplaceRegistryService,
        private tokenManager: TokenManagerService,
        private broker: MarketplaceTokenBrokerService,
        private adapterRegistry: MarketplaceAdapterRegistry,
    ) { }

    /** @deprecated Registre no MarketplaceAdapterRegistry. Mantido como ponte durante a migração dos adapters. */
    registerAdapter(adapter: IMarketplaceAuthAdapter) {
        this.adapterRegistry.registerAuthAdapter(adapter);
    }

    getAdapter(tagOrName: string): IMarketplaceAuthAdapter {
        return this.adapterRegistry.getAuthAdapter(tagOrName);
    }

    async findByName(name: string): Promise<MarketplaceDocument> {
        return this.registryService.findByName(name);
    }

    /** Troca o code por token (adapter do provider) e persiste na conta do domínio. */
    async authenticate(
        marketplaceId: number | string,
        authData: { code: string; redirectUri?: string; shopId?: string; domain?: string;[key: string]: any },
    ): Promise<any> {
        const marketplace = await this.registryService.findOne(String(marketplaceId));
        if (!marketplace) throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
        if (marketplace.enabled === false) throw new BadRequestException(`Marketplace ${marketplace.name} está desativado.`);

        const adapter = this.getAdapter(marketplace.tag || marketplace.name);
        const credentials = await this.broker.credentialsForDomain(String(marketplace._id), authData.domain);
        const tokenData = await adapter.authenticate(authData.code, { ...authData, credentials });
        await this.broker.saveTokenForDomain(String(marketplace._id), authData.domain, tokenData);
        return tokenData;
    }

    async generateAuthUrl(marketplaceId: number | string | any, redirectUri: string): Promise<{ authUrl: string }> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
        if (marketplace.enabled === false) throw new BadRequestException(`Marketplace ${marketplace.name} está desativado.`);

        const adapter = this.getAdapter(marketplace.tag || marketplace.name);
        const credentials = await this.broker.credentialsForDomain(String(marketplace._id));
        return adapter.generateAuthUrl(redirectUri, { credentials });
    }

    /**
     * Token válido para um marketplace (opcionalmente por domínio, multi-client).
     * Para oauth2, o TokenManager delega ao broker (que renova se expirando).
     * Estratégias não-oauth (aws_sigv4/none/api_key/hybrid) seguem inalteradas.
     */
    async ensureValidToken(marketplaceId: string | any, domain?: string): Promise<ResolvedToken> {
        const idStr = String(marketplaceId);
        if (!/^[0-9a-fA-F]{24}$/.test(idStr)) {
            throw new Error(`Invalid Marketplace ID format for token check: ${idStr}`);
        }
        return this.tokenManager.resolveToken(idStr, domain);
    }

    /**
     * Força a renovação do token oauth2 (ignora o buffer) e devolve o renovado.
     * Selector: string (domain, legado) ou { accountId?, domain? } — accountId tem
     * precedência (conta de entrada já determinada). Delega ao TokenManager.
     */
    async forceRefreshToken(
        marketplaceId: string | any,
        selector?: string | { accountId?: string; domain?: string },
    ): Promise<ResolvedToken> {
        return this.tokenManager.forceRefresh(String(marketplaceId), selector);
    }

    /**
     * Persiste um token vindo de um fluxo externo (ex.: OLX client_credentials)
     * na conta do domínio. Ponte de compatibilidade — delega ao broker.
     */
    async saveToken(marketplaceId: number | string | any, tokenData: any, domain?: string): Promise<any> {
        if (!tokenData?.accessToken) throw new Error('accessToken é obrigatório');
        await this.broker.saveTokenForDomain(String(marketplaceId), domain, tokenData);
        return tokenData;
    }
}
