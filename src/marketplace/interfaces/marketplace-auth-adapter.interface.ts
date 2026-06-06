/**
 * Credenciais por conta (multi-client), opcionalmente passadas pelo broker via
 * `additionalData.credentials`. Quando ausentes, o adapter resolve do env/config
 * (caminho single-client legado). clientId/secret já vêm em PLAINTEXT (o broker
 * descriptografa antes de chamar).
 */
export interface AdapterAccountCredentials {
    clientId?: string;
    clientSecret?: string;
    [key: string]: string | undefined;
}

export interface IMarketplaceAuthAdapter {
    /**
     * Unique name of the marketplace (e.g., 'Mercado Livre', 'Shopee')
     */
    readonly name: string;
    readonly tag: string;

    /**
     * Authenticates using an authorization code and returns the token data.
     * @param code The authorization code received from the marketplace callback.
     * @param additionalData Dados extras (ex.: shopId Shopee, redirectUri, state).
     *        Pode conter `credentials` (AdapterAccountCredentials) para multi-client.
     */
    authenticate(code: string, additionalData?: any): Promise<any>;

    /**
     * Refreshes an existing access token.
     * @param token The current token data (including refresh token).
     * @param credentials Credenciais da conta (multi-client). Ausente → env/config.
     */
    refreshToken(token: any, credentials?: AdapterAccountCredentials): Promise<any>;

    /**
     * Generates the URL for the user to authorize the application.
     * @param redirectUri The URI to redirect back to after authorization.
     * @param options `state` (accountId) e `credentials` para multi-client.
     */
    generateAuthUrl(redirectUri?: string, options?: { state?: string; credentials?: AdapterAccountCredentials }): Promise<{ authUrl: string }>;

    /**
     * Optional: Validates if the current configuration/credentials are correct.
     */
    testCredentials?(): Promise<boolean>;
}
