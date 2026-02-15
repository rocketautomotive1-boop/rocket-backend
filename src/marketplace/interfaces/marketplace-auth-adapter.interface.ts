export interface IMarketplaceAuthAdapter {
    /**
     * Unique name of the marketplace (e.g., 'Mercado Livre', 'Shopee')
     */
    readonly name: string;
    readonly tag: string;

    /**
     * Authenticates using an authorization code and returns the token data.
     * @param code The authorization code received from the marketplace callback.
     * @param additionalData Any additional data required for authentication (e.g., shopId for Shopee).
     */
    authenticate(code: string, additionalData?: any): Promise<any>;

    /**
     * Refreshes an existing access token.
     * @param token The current token data (including refresh token).
     */
    refreshToken(token: any): Promise<any>;

    /**
     * Generates the URL for the user to authorize the application.
     * @param redirectUri The URI to redirect back to after authorization.
     */
    generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }>;

    /**
     * Optional: Validates if the current configuration/credentials are correct.
     */
    testCredentials?(): Promise<boolean>;
}
