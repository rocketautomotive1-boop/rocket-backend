/**
 * Tipo de token de marketplace usado pelos adapters como contrato de
 * authenticate()/refreshToken().
 *
 * NOTA: já foi um @Schema Mongoose (coleção `marketplace_tokens`), mas essa
 * coleção nunca foi escrita em runtime — o token canônico vive embarcado em
 * `marketplaces.tokens[]` (MarketplaceTokenSnapshot) e, no modelo unificado, em
 * `marketplaces.accounts[].token`. Aqui ficou apenas o TIPO, consumido por ~14
 * arquivos (adapters/controllers). Não registrar como model novamente.
 */
export class MarketplaceToken {
    marketplaceId?: number | string | any;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    tokenType?: string;
    additionalData?: Record<string, any>;
    isActive?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

/** Alias histórico — antes era `MarketplaceToken & Document`. Mantido como tipo puro. */
export type MarketplaceTokenDocument = MarketplaceToken;
