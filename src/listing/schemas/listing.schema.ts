import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ListingDocument = HydratedDocument<ListingModel>;

@Schema({ collection: 'listings', timestamps: true })
export class ListingModel {
    _id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true, index: true })
    marketplaceId: Types.ObjectId;

    // Loja DONA deste anúncio — parte da IDENTIDADE do listing (não decoração):
    // o mesmo produto pode ter um listing por loja no mesmo marketplace,
    // simultaneamente (ver unicidade {productId, marketplaceId, storeId} abaixo).
    // Resolvida uma única vez, no momento da criação do listing (usuário logado
    // → user.storeId), e gravada como snapshot imutável — nunca reinferida a
    // cada sync. Trocar a loja de um usuário depois não reroteia listings já
    // criados. Opcional durante a migração: listings pré-backfill ficam sem
    // storeId até o script de backfill resolver o dono.
    @Prop({ type: Types.ObjectId, ref: 'StoreModel', index: true })
    storeId?: Types.ObjectId;

    @Prop({ type: String, sparse: true })
    externalId?: string; // ID do anúncio no marketplace

    @Prop({ required: true })
    title: string;

    @Prop({
        type: String,
        enum: ['active', 'paused', 'error', 'pending_creation', 'pending_removal', 'removal_failed', 'removed'],
        default: 'pending_creation'
    })
    status: string;

    @Prop({ default: 'pt-BR' })
    locale: string;

    @Prop({ default: true })
    synchronized: boolean;

    @Prop({ type: String })
    errorMessage?: string;

    @Prop({ type: Object })
    marketplaceData?: any; // Dados extras específicos do MktPlace

    @Prop()
    sku?: string; // Algumas plataformas exigem SKU específico no anúncio

    // Per-marketplace price override lives in PricingModule (product_pricing.overrides), not on
    // the listing — the listing is an integration artifact, not a pricing decision.

    @Prop()
    lastSyncAt?: Date;

    // Distributed in-flight lock. Set when a publish job is dispatched to RabbitMQ.
    // Cleared by SyncResultConsumer when the job result arrives (success or failure).
    // Acts as a per-listing mutex — prevents concurrent dispatches regardless of force flag.
    // TTL: 2 minutes (orchestrator enforces stale expiry before allowing re-lock).
    @Prop({ type: Date, default: null })
    publishingAt?: Date | null;

    // Decisão de publicar via catalog listing do ML (catalog_product_id de peça) em vez de
    // item comum. Gravado uma única vez, lazy, quando o listing ainda não tem externalId —
    // ver InternalProductController.getListings. Imutável depois de gravado: nunca
    // recalculado, mesmo que o produto perca elegibilidade depois (congelamento intencional,
    // ver docs/superpowers/specs/2026-07-15-ml-catalog-listing-publish-design.md).
    @Prop({ type: Object })
    catalogListing?: {
        enabled: boolean;
        catalogProductId: string;
        decidedAt: Date;
    };

    createdAt: Date;
    updatedAt: Date;
}

export const ListingSchema = SchemaFactory.createForClass(ListingModel);

// Índice composto para buscar todos os anúncios de um produto (todas as lojas) rapidamente.
ListingSchema.index({ productId: 1, marketplaceId: 1 });

// Um produto pode ter N listings ATIVOS por (marketplace, loja) — o mesmo produto físico
// vende com títulos diferentes por veículo compatível (limite de 60 caracteres do ML), cada
// um com seu próprio externalId. A constraint de unicidade real já é garantida pelo índice
// {marketplaceId, externalId} logo abaixo (globalmente mais forte: dois documentos só
// colidem aqui se JÁ colidissem lá, já que ambos compartilham marketplaceId+externalId) —
// por isso NÃO é unique aqui, só um índice de suporte a query por
// (productId, marketplaceId, storeId, externalId) sem se transformar em constraint
// duplicada/redundante.
ListingSchema.index(
    { productId: 1, marketplaceId: 1, storeId: 1, externalId: 1 },
    { partialFilterExpression: { storeId: { $exists: true }, externalId: { $type: 'string' } } },
);

// Índice único parcial: garante unicidade do externalId APENAS se ele existir e for
// string (exclui null/pendentes). Um externalId do ML pertence a exatamente UMA conta
// (⇒ uma loja), então (marketplaceId, externalId) continua sendo chave única global —
// duas lojas nunca colidem no mesmo externalId.
ListingSchema.index(
    { marketplaceId: 1, externalId: 1 },
    {
        unique: true,
        partialFilterExpression: { externalId: { $type: 'string' } }
    }
);

// Roteamento de saída por loja dona: UPDATE/DELETE/operacional resolvem a conta de
// publicação a partir de storeId → store.accounts[marketplaceTag] (não pela conta
// ativa da tela).
ListingSchema.index(
    { marketplaceId: 1, storeId: 1 },
    { partialFilterExpression: { storeId: { $exists: true } } },
);
