import { Injectable, Logger } from '@nestjs/common';

interface TokenCache {
    accessToken: string;
    expiresAt: number; // Timestamp in milliseconds
}

@Injectable()
export class TokenManagerService {
    private readonly logger = new Logger(TokenManagerService.name);
    private tokens: Map<string, TokenCache> = new Map();

    /**
     * Retrieves a valid access token. If not cached or expired, it calls the fetchFn.
     * @param providerKey Unique key for the provider (e.g., 'FEDEX')
     * @param fetchFn Async function to fetch a new token if needed. Should return { accessToken, expiresInSeconds }
     */
    async getToken(
        providerKey: string,
        fetchFn: () => Promise<{ accessToken: string; expiresInSeconds: number }>,
    ): Promise<string> {
        const now = Date.now();
        const cached = this.tokens.get(providerKey);

        // Buffer to refresh token slightly before it actually expires (e.g., 60 seconds)
        const bufferTime = 60 * 1000;

        if (cached && cached.expiresAt > now + bufferTime) {
            // this.logger.debug(`Using cached token for ${providerKey}`);
            return cached.accessToken;
        }

        this.logger.log(`Fetching new access token for ${providerKey}...`);
        try {
            const { accessToken, expiresInSeconds } = await fetchFn();

            this.tokens.set(providerKey, {
                accessToken,
                expiresAt: now + (expiresInSeconds * 1000),
            });

            return accessToken;
        } catch (error) {
            this.logger.error(`Failed to fetch token for ${providerKey}`, error);
            throw error;
        }
    }
}
