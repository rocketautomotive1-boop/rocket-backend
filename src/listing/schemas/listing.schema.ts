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

    @Prop({ type: String, sparse: true })
    externalId?: string; // ID do anúncio no marketplace

    @Prop({ required: true })
    title: string;

    @Prop({
        type: String,
        enum: ['active', 'paused', 'error', 'pending_creation', 'pending_removal', 'removed'],
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

    @Prop()
    price?: number; // Override de preço opcional

    @Prop()
    lastSyncAt?: Date;

    // Distributed in-flight lock. Set when a publish job is dispatched to RabbitMQ.
    // Cleared by ListingStatusListener when the job result arrives (success or failure).
    // Acts as a per-listing mutex — prevents concurrent dispatches regardless of force flag.
    // TTL: 2 minutes (orchestrator enforces stale expiry before allowing re-lock).
    @Prop({ type: Date, default: null })
    publishingAt?: Date | null;

    createdAt: Date;
    updatedAt: Date;
}

export const ListingSchema = SchemaFactory.createForClass(ListingModel);

// Índice composto para buscar anúncios de um produto rapidamente
ListingSchema.index({ productId: 1, marketplaceId: 1 });

// Índice único parcial: Garante unicidade do externalId APENAS se ele existir e for string (exclui null/pendentes)
ListingSchema.index(
    { marketplaceId: 1, externalId: 1 },
    {
        unique: true,
        partialFilterExpression: { externalId: { $type: 'string' } }
    }
);
