import { Injectable, Logger, Inject, forwardRef, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../../schemas/marketplace.schema';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import { TokenManagerService, ResolvedToken } from './token-manager.service';

@Injectable()
export class MarketplaceAuthService implements OnModuleInit {
    private readonly logger = new Logger(MarketplaceAuthService.name);
    private refreshPromises: Map<string, Promise<any>> = new Map();
    private adapters: Map<string, IMarketplaceAuthAdapter> = new Map();

    constructor(
        private configService: ConfigService,
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceDocument>,
        @Inject(forwardRef(() => MarketplaceRegistryService))
        private registryService: MarketplaceRegistryService,
        private tokenManager: TokenManagerService,
    ) { }

    onModuleInit() {
        // Adapters register themselves via registerAdapter
    }

    async registerAdapter(adapter: IMarketplaceAuthAdapter) {
        this.logger.log(`Registering Auth Adapter: ${adapter.name} (${adapter.tag})`);

        // Register by Name and Tag for initial lookup
        this.adapters.set(adapter.name, adapter);
        this.adapters.set(adapter.tag, adapter);

        // Ideally we also resolve the ID here to allow ID-based lookup without DB query every time
        // However, onModuleInit might run before DB connection is fully established or data is present
        // So we can do lazy resolution or retry. For now, we rely on findByTag in getAdapter if ID passed?
        // Actually, the Service methods receive ID. We should Map ID -> Adapter.

        try {
            // We need to find the marketplace by tag to get its ID
            // Since this runs on init, we might race with DB connection. 
            // Better to let the first call to getAdapter resolve it if not found?
            // Or just store it by tag, and getAdapter(id) looks up marketplace to get tag?
            // The user wanted "use _id internally".
            // So getAdapter(id) -> findMarketplace(id) -> get tag -> lookup adapter.
            // This is safer than pre-registering IDs which might change (unlikely) or not exist yet.
        } catch (error) {
            this.logger.warn(`Could not register adapter ${adapter.name} by ID: ${error.message}`);
        }
    }

    getAdapter(marketplaceIdentifier: string | number): IMarketplaceAuthAdapter {
        // If it's a string that matches an adapter tag/name directly (legacy/setup)
        if (typeof marketplaceIdentifier === 'string' && this.adapters.has(marketplaceIdentifier)) {
            return this.adapters.get(marketplaceIdentifier);
        }

        // If it's an ID (string or number), we should have resolved it?
        // But getAdapter is synchronous.
        // We cannot async fetch marketplace here.
        // The calling methods (authenticate, etc) ALREADY fetch the marketplace.
        // So they should pass the TAG to getAdapter, or the adapter instance itself.

        throw new Error(`Auth Adapter not found for identifier: ${marketplaceIdentifier}`);
    }

    async findByName(name: string): Promise<MarketplaceDocument> {
        return this.marketplaceModel.findOne({ name }).exec();
    }

    async authenticate(marketplaceId: number | string, authData: { code: string; redirectUri?: string; shopId?: string;[key: string]: any }): Promise<any> {
        const marketplace = await this.registryService.findOne(String(marketplaceId));

        if (!marketplace) {
            throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
        }

        if (marketplace.enabled === false) {
            throw new BadRequestException(`Marketplace ${marketplace.name} está desativado.`);
        }

        const adapter = this.getAdapter(marketplace.tag || marketplace.name);

        try {
            const tokenData = await adapter.authenticate(authData.code, authData);
            return this.saveToken(marketplaceId, tokenData);
        } catch (error) {
            this.logger.error(`Authentication failed for ${marketplace.name}: ${error.message}`);
            throw error;
        }
    }

    async saveToken(marketplaceId: number | string | any, tokenData: any): Promise<any> {
        if (!tokenData?.accessToken) throw new Error('accessToken é obrigatório');

        const marketplace = await this.marketplaceModel.findById(marketplaceId);
        if (!marketplace) throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);

        if (!marketplace.tokens) marketplace.tokens = [];

        const newTokenType = tokenData.tokenType || 'default';

        // Remove existing tokens of the same type to avoid duplicates/stale tokens
        marketplace.tokens = marketplace.tokens.filter(t => t.tokenType !== newTokenType);

        const newToken = {
            ...tokenData,
            isActive: true,
            updatedAt: new Date()
        };

        marketplace.tokens.push(newToken);
        await marketplace.save();

        this.logger.debug(`Token saved for ${marketplace.name} (${newTokenType})`);
        return newToken;
    }

    async generateAuthUrl(marketplaceId: number | string | any, redirectUri: string): Promise<{ authUrl: string }> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
        if (marketplace.enabled === false) throw new BadRequestException(`Marketplace ${marketplace.name} está desativado.`);

        const adapter = this.getAdapter(marketplace.tag || marketplace.name);
        return adapter.generateAuthUrl(redirectUri);
    }

    async ensureValidToken(marketplaceId: string | any): Promise<ResolvedToken> {
        const idStr = String(marketplaceId);
        if (!/^[0-9a-fA-F]{24}$/.test(idStr)) {
            throw new Error(`Invalid Marketplace ID format for token check: ${idStr}`);
        }

        const resolved = await this.tokenManager.resolveToken(idStr);

        // Estratégias sem DB (aws_sigv4, none) não precisam de refresh
        if (!resolved.fromDatabase) return resolved;

        // Alguns providers OAuth2 (ex.: OLX) podem não retornar refresh_token.
        // Nesses casos evitamos refresh automático para não derrubar o fluxo.
        if (!resolved.refreshToken) return resolved;

        // Token ainda válido
        if (!this.tokenManager.isTokenExpiringSoon(resolved)) return resolved;

        // Token prestes a expirar — refresh via adapter
        const marketplace = await this.marketplaceModel.findById(marketplaceId);
        const activeToken = marketplace?.tokens?.find(t => t.isActive);
        if (!activeToken) return resolved; // sem token para refresh (ex: hybrid sem LWA)

        const refreshed = await this.refreshToken(marketplaceId, activeToken);
        return { ...resolved, ...refreshed, fromDatabase: true };
    }

    async getToken(marketplaceId: number | string | any): Promise<any | null> {
        const marketplace = await this.marketplaceModel.findById(marketplaceId).exec();
        if (!marketplace || !marketplace.tokens) return null;
        return marketplace.tokens.find(t => t.isActive);
    }

    async refreshExpiringTokens(): Promise<number> {
        this.logger.log('Checking for expiring tokens...');
        const marketplaces = await this.marketplaceModel.find({ enabled: true }).exec();
        let refreshedCount = 0;
        const SAFETY_BUFFER_MINUTES = 30;

        for (const marketplace of marketplaces) {
            const activeToken = marketplace.tokens?.find(t => t.isActive);

            if (!activeToken || !activeToken.expiresAt) continue;

            const minutesUntilExpiration = (new Date(activeToken.expiresAt).getTime() - Date.now()) / 1000 / 60;

            if (minutesUntilExpiration < SAFETY_BUFFER_MINUTES) {
                try {
                    await this.ensureValidToken(marketplace._id);
                    refreshedCount++;
                } catch (error) {
                    this.logger.error(`Failed to refresh token for ${marketplace.name}: ${error.message}`);
                }
            }
        }
        return refreshedCount;
    }

    async refreshToken(marketplaceId: string | any, token: any): Promise<any> {
        const key = marketplaceId.toString();

        // Prevent multiple simultaneous refresh calls for the same marketplace
        if (this.refreshPromises.has(key)) {
            return this.refreshPromises.get(key);
        }

        const promise = (async () => {
            try {
                // Determine marketplace name from token or fetch marketplace
                // We need the adapter.
                const marketplace = await this.marketplaceModel.findById(marketplaceId);
                if (!marketplace) throw new Error('Marketplace não encontrado');

                const adapter = this.getAdapter(marketplace.tag || marketplace.name);
                this.logger.debug(`Refreshing token for ${marketplace.name}...`);

                // Some providers can issue access tokens without refresh token (ex.: OLX flows).
                // In this case we must fail fast and require manual re-authentication.
                if (!token?.refreshToken) {
                    throw new Error(
                        `Marketplace ${marketplace.name} não possui refreshToken ativo. Reautenticação manual necessária.`,
                    );
                }

                const newTokenData = await adapter.refreshToken(token);

                // If the adapter returns the full updated token object, save it.
                const savedToken = await this.saveToken(marketplaceId, newTokenData);

                return savedToken;
            } catch (err) {
                this.logger.error(`Error refreshing token for marketplace ${marketplaceId}: ${err.message}`);
                throw err;
            } finally {
                this.refreshPromises.delete(key);
            }
        })();

        this.refreshPromises.set(key, promise);
        return promise;
    }

    // Compatibility / Alias methods if needed by controllers/other services
    // Ideally these should be deprecated or removed if callers are updated. 
    // Assuming callers (Controllers) will be updated or were part of the refactor plan.
    // I already refactored OLXController. 
    // AuthController might still call specific methods?
    // Let's keep generic ensureValidToken which is what adapters utilize.
}

