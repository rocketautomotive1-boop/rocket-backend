import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BalcaoOrderDraftDocument = BalcaoOrderDraftModel & Document;

export interface BalcaoOrderDraftItem {
    productId: string;
    title?: string;
    quantity: number;
    unitPrice: number;
}

/**
 * Rascunho de vida curta para o fluxo de venda balcão: criado pelo endpoint
 * POST /orders/balcao, lido uma única vez por BalcaoOrderAdapter.getOrderDetails
 * (que o marca 'processed'), nunca consultado depois disso.
 */
@Schema({ collection: 'balcao_order_drafts', timestamps: true })
export class BalcaoOrderDraftModel {
    @Prop({ required: true, unique: true })
    externalId: string;

    @Prop({ default: 'pending' })
    status: 'pending' | 'processed' | 'error';

    @Prop({ type: Object, required: true })
    data: { items: BalcaoOrderDraftItem[] };

    @Prop()
    error?: string;
}

export const BalcaoOrderDraftSchema = SchemaFactory.createForClass(BalcaoOrderDraftModel);
