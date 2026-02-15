import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';

@Injectable()
export class MarketplaceResilienceService {
    private readonly logger = new Logger(MarketplaceResilienceService.name);

    constructor(
        private readonly authService: MarketplaceAuthService,
    ) { }

    async execute<T>(
        marketplaceId: string,
        operation: (token: any) => Promise<T>
    ): Promise<T> {
        let token: any;
        try {
            // 1. Initial Token Fetch (Fresh Logic)
            // Workers delegate the "Get Token" responsibility here to ensure freshness
            token = await this.authService.ensureValidToken(marketplaceId);
        } catch (error) {
            this.logger.error(`[Resilience] Pre-check failed for ${marketplaceId}: ${error.message}`);
            throw error;
        }

        try {
            // 2. Try Operation
            return await operation(token);
        } catch (error) {
            if (this.isAuthError(error)) {
                this.logger.warn(`[Resilience] Auth error detected for ${marketplaceId}. Refreshing token and retrying...`);

                try {
                    // 3. Force Refresh
                    // We pass the current token so the adapter knows what to refresh
                    const newToken = await this.authService.refreshToken(marketplaceId, token);

                    // 4. Retry Operation with New Token
                    return await operation(newToken);
                } catch (retryError) {
                    this.logger.error(`[Resilience] Retry failed for ${marketplaceId}: ${retryError.message}`);
                    throw retryError;
                }
            }
            throw error;
        }
    }

    private isAuthError(error: any): boolean {
        if (!error) return false;

        // Axios Response Status
        const status = error.response?.status;
        if (status === 401 || status === 403) return true;

        // Message Analysis (Common patterns for Shopee/Meli/etc)
        const msg = String(error.response?.data?.error || error.response?.data?.message || error.message || '').toLowerCase();

        return /invalid_acce?ess_token|invalid_access_token|error_auth|unauthorized|invalid_token/i.test(msg);
    }
}
