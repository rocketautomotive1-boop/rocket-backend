import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderDocument = HydratedDocument<OrderModel>;

@Schema()
export class OrderItemSnapshot {
    @Prop() externalId?: string; // Marketplace Item ID / Line Item ID
    @Prop() sku?: string;        // SellerSKU / item_sku do marketplace (preservado para debug e retificação)
    @Prop() asin?: string;       // ASIN Amazon (quando disponível)
    @Prop() title: string;
    @Prop() quantity: number;
    @Prop() unitPrice: number;

    @Prop() costPriceAtSale?: number; // Snapshot of cost at time of sync

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', default: null })
    productId?: Types.ObjectId; // The single source of truth for Product Link
}

@Schema()
class OrderLogSnapshot {
    @Prop() logType: string; // Renamed from type
    @Prop() message: string;
    @Prop({ type: Object }) details: any;
    @Prop() createdAt: Date;
}

@Schema()
class OrderCustomerSnapshot {
    @Prop() name: string;
    @Prop() document: string;
    @Prop() email: string;
    @Prop() phone: string;

    @Prop({ type: Object })
    address: {
        zipCode: string;
        street: string;
        number: string;
        neighborhood: string;
        city: string;
        state: string;
    };
}

@Schema()
class OrderPaymentSnapshot {
    @Prop() methodId: string;
    @Prop() paymentType: string; // Renamed from type
    @Prop() authorizationCode: string; // from MySQL 'authorizationCode'
}

@Schema()
class OrderItemPricingSnapshot {
    @Prop() externalId?: string;
    @Prop() sku?: string;
    @Prop() title: string;
    @Prop() quantity: number;
    @Prop() unitPrice: number;
    @Prop() costPrice: number;

    @Prop() grossProfit: number;
    @Prop() profitMarginPercent: number;

    @Prop() commissionAmount: number;
    @Prop() commissionRate: number;

    @Prop() taxAmount: number;
    @Prop() taxRate: number;

    @Prop() freightAmount: number;

    @Prop() netProfit: number;
    @Prop() netMarginPercent: number;
}

@Schema()
class OrderPricingSnapshot {
    @Prop({ type: [SchemaFactory.createForClass(OrderItemPricingSnapshot)] })
    items: OrderItemPricingSnapshot[];

    @Prop({ type: Object })
    totals: {
        grossRevenue: number;
        totalCostOfGoods: number;
        totalCommission: number;
        totalTaxes: number;
        totalFreight: number;
        totalOtherCosts: number;
        totalGrossProfit: number;
        totalNetProfit: number;
        avgCostPrice: number;
        avgSellingPrice: number;
        profitMarginPercent: number;
    };

    @Prop() strategy: string; // e.g., 'MERCADOLIVRE'
    @Prop() calculatedAt: Date;
}

@Schema({ collection: 'orders', timestamps: true })
export class OrderModel {
    @Prop({ required: true, unique: true })
    externalId: string; // "MLB-12345"

    @Prop({ type: Types.ObjectId, required: true })
    marketplaceId: Types.ObjectId;

    /**
     * Conta multi-client (accounts[]._id) que RECEBEU este pedido, resolvida na
     * borda do webhook a partir do user_id do marketplace. Persistida para que
     * fulfillment/NF-e/update-status operem na conta correta. Ausente em pedidos
     * legados (single-client) → cai na conta default.
     */
    @Prop()
    accountId?: string;

    @Prop({ required: true, index: true })
    status: string;

    @Prop({ required: true, default: 0 })
    totalAmount: number;

    @Prop({ required: true, default: 0 })
    shippingAmount: number;

    @Prop({ default: 'pending', index: true }) // 'pending' | 'processing' | 'deducted' | 'unresolved' | 'error' | 'skipped'
    logisticsStatus: string;

    @Prop()
    trackingCode: string;

    @Prop({ type: OrderCustomerSnapshot })
    customer: OrderCustomerSnapshot;

    @Prop({ type: Object })
    payment: {
        method: string;
        marketplaceFee: number;    // Commission/fee charged by the marketplace
        netAmount: number;         // Amount seller actually receives
        grossAmount: number;       // Total paid by buyer (total_paid_amount)
        couponAmount: number;      // Marketplace coupon discount applied
        taxAmount: number;         // Taxes withheld at source
        installments: number;
        authorizationCode?: string; // Payment authorization code
    };

    @Prop()
    packId?: string; // ML pack_id — required for /packs/{packId}/fiscal_documents

    @Prop({ type: Object })
    marketplaceData?: Record<string, any>; // Raw marketplace-specific extra fields

    @Prop({ type: [SchemaFactory.createForClass(OrderItemSnapshot)] })
    items: OrderItemSnapshot[];

    @Prop({ type: [{ type: Types.ObjectId, ref: 'StockMovementModel' }] })
    stockMovementIds: Types.ObjectId[];

    @Prop({ type: [SchemaFactory.createForClass(OrderLogSnapshot)] })
    logs: OrderLogSnapshot[];

    @Prop({
        type: [{
            status: String,
            at: Date,
            trigger: String,
            details: Object
        }],
        default: []
    })
    history: any[];

    @Prop({ default: 'idle', index: true }) // 'idle', 'processing', 'completed', 'failed'
    processingStatus: string;

    @Prop()
    syncedAt: Date;

    @Prop({ type: SchemaFactory.createForClass(OrderPricingSnapshot) })
    pricing?: OrderPricingSnapshot; // Pricing calculation snapshot

    @Prop({ type: Object })
    financialSnapshot?: {
        gross: number;       // Valor bruto pago pelo comprador (ML billing API > payment)
        commission: number;  // Comissão do marketplace
        freight: number;     // Frete cobrado do vendedor
        taxes: number;       // Impostos retidos
        coupon: number;      // Cupom aplicado
        net: number;         // Receita líquida recebida
        costTotal: number;   // Custo dos produtos
        grossProfit: number; // Lucro bruto (net - custo)
        marginPct: number;   // Margem % (grossProfit / gross * 100)
        resolvedAt: Date;    // Quando foi resolvido
    };

    @Prop({ type: Object })
    notificationStatus?: {
        whatsapp?: {
            status: 'pending' | 'queued' | 'sent' | 'failed' | 'skipped_old' | 'manual_required';
            attempts?: number;
            lastAttemptAt?: Date;
            nextRetryAt?: Date;
            sentAt?: Date;
            error?: string;
            reason?: string;
        };
    };

    @Prop()
    marketplaceTag?: string; // denormalized adapter tag for reconcile/gateway

    @Prop({ type: Object })
    reconcile?: {
        lastCheckedAt?: Date;
        detectedBy?: 'webhook' | 'reconcile' | 'gap-detector';
    };

    fiscalDocuments?: any[];
}

export const OrderSchema = SchemaFactory.createForClass(OrderModel);
OrderSchema.virtual('fiscalDocuments', {
    ref: 'FiscalDocumentModel',
    localField: '_id',
    foreignField: 'order'
});
OrderSchema.set('toObject', { virtuals: true });
OrderSchema.set('toJSON', { virtuals: true });
OrderSchema.index({ 'customer.document': 1 }); // Great for customer history lookup
OrderSchema.index({ marketplaceId: 1, status: 1 });
OrderSchema.index({ logisticsStatus: 1, status: 1 });
OrderSchema.index({ 'items.productId': 1 });
