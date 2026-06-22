import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MarketplaceDocument = HydratedDocument<MarketplaceModel>;

@Schema()
class MarketplaceTokenSnapshot {
    @Prop() accessToken: string;
    @Prop() refreshToken: string;
    @Prop() expiresAt: Date;
    @Prop() tokenType: string;
    @Prop({ type: Object }) additionalData: any;
    @Prop({ default: true }) isActive: boolean;
}

/**
 * Conta de marketplace (multi-client) embarcada em `marketplaces.accounts[]`.
 * Modelo unificado que substitui a coleção `marketplace_accounts`: cada conta
 * tem credenciais cifradas próprias (enc:v1:..., via credentials-crypto.helper)
 * e seu próprio token OAuth. `_id` é estável (usado como `state` no OAuth).
 *
 * Invariantes garantidas em nível de aplicação (Mongo não faz unique parcial
 * dentro de array): no máx. 1 conta `isDefault` por marketplace; `label` único
 * por marketplace. Domínios canônicos do produto: 'autopecas' | 'general'.
 */
@Schema({ _id: true })
export class MarketplaceAccountSnapshot {
    @Prop({ required: true }) label: string;
    @Prop({ default: false }) isDefault: boolean;
    @Prop({ type: [String], default: [] }) domains: string[];
    /** Credenciais cifradas da conta (clientId/clientSecret/...). Vazio → cai em marketplaces.credentials. */
    @Prop({ type: Object, default: {} }) credentials: Record<string, string>;
    @Prop({ type: MarketplaceTokenSnapshot }) token: MarketplaceTokenSnapshot;
}

@Schema()
export class MarketplaceRequirementSnapshot {
    @Prop() fieldName: string; // The field name expected by the Marketplace API
    @Prop() schemaField: string; // The corresponding field path in the Product Schema (e.g., 'name', 'dimensions.height')
    @Prop() displayName: string;
    @Prop() description: string;
    @Prop({ default: false }) isRequired: boolean;
    @Prop() dataType: string;
    @Prop({ type: Object }) validationRules: any;
    @Prop({ type: Object }) options: any;
    @Prop({ default: 0 }) displayOrder: number;
}

@Schema()
export class MarketplaceDescriptionTemplateSnapshot {
    @Prop({ required: true, length: 100 })
    name: string;

    @Prop({ required: true, length: 255 })
    title: string;

    @Prop({ required: true, type: String })
    template: string;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ default: false })
    isDefault: boolean;

    /**
     * Domínio do produto que este template atende (ex.: 'general' p/ suplementos).
     * Ausente/'autopecas' = template padrão (autopeças), preservando o legado.
     */
    @Prop({ type: String, required: false })
    domain?: string;

    @Prop({ type: Object, nullable: true })
    placeholders: Record<string, any>;

    @Prop({ type: [Object], nullable: true })
    sections: Record<string, any>[];
}

export type TokenStrategy = 'oauth2' | 'aws_sigv4' | 'hybrid' | 'api_key' | 'none';

@Schema({ collection: 'marketplaces', timestamps: true })
export class MarketplaceModel {
    @Prop({ required: true, unique: true })
    name: string;

    @Prop({ unique: true, sparse: true })
    tag: string;

    @Prop({ default: true })
    enabled: boolean;

    /**
     * Estratégia de autenticação do marketplace.
     * oauth2  → token OAuth2 salvo no DB (ML, Shopee, OLX)
     * aws_sigv4 → apenas variáveis de ambiente AWS (não precisa de token no DB)
     * hybrid  → LWA OAuth2 no DB + SigV4 via env (Amazon SP-API)
     * api_key → chave estática em settings.apiKey
     * none    → sem autenticação necessária
     */
    @Prop({ default: 'oauth2' })
    tokenStrategy: TokenStrategy;

    @Prop()
    logoUrl: string;

    @Prop()
    description: string;

    @Prop({ type: Object })
    settings: any;

    /**
     * Contas multi-client (token + credenciais por domínio). Fonte ÚNICA de
     * token/credenciais — substituiu a coleção `marketplace_accounts` e o
     * campo legado `tokens[]` (removido na unificação).
     */
    @Prop({ type: [SchemaFactory.createForClass(MarketplaceAccountSnapshot)], default: [] })
    accounts: MarketplaceAccountSnapshot[];

    /**
     * Mapa EXPLÍCITO de roteamento de SAÍDA (publicação) por domínio do produto:
     * `{ autopecas: accountId, general: accountId }`. Configurado na tela de
     * Configurações (substitui o vínculo implícito via `accounts[].domains`).
     *
     * Semântica das três situações que `accountFor` distingue:
     *  - chave AUSENTE  → domínio nunca configurado → fallback (isDefault → 1ª conta).
     *  - chave = accountId → publica com essa conta.
     *  - chave = null     → domínio DESLIGADO neste marketplace → não publicar.
     *
     * Config estável (servida via cache); escrita só pela tela → invalida cache.
     */
    @Prop({ type: Object, default: {} })
    routing: Record<string, string | null>;

    /**
     * Credenciais semi-estáticas do marketplace que NÃO variam por conta
     * (ex.: partnerKey Shopee). Cifradas (enc:v1:...). Escritas por
     * MarketplaceCredentialsService — declaradas aqui para serem first-class em reads .lean().
     */
    @Prop({ type: Object, default: {} })
    credentials: Record<string, string>;

    @Prop({ type: [SchemaFactory.createForClass(MarketplaceRequirementSnapshot)] })
    requirements: MarketplaceRequirementSnapshot[];

    @Prop({ type: [SchemaFactory.createForClass(MarketplaceDescriptionTemplateSnapshot)] })
    templates: MarketplaceDescriptionTemplateSnapshot[];

    @Prop()
    lockUntil: Date;
}

export const MarketplaceSchema = SchemaFactory.createForClass(MarketplaceModel);

// Add virtual 'id' that returns _id as string for frontend compatibility
MarketplaceSchema.virtual('id').get(function () {
    return this._id.toString();
});

// Ensure virtuals are included when converting to JSON
MarketplaceSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        (ret as any).id = ret._id.toString();

        return ret;
    }
});
