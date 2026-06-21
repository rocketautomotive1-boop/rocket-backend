import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { PRODUCT_RESOLVER_PORT, ProductResolverPort } from '../ports/product-resolver.port';

@Injectable()
export class OrderMapperService {
    constructor(
        @Inject(PRODUCT_RESOLVER_PORT)
        private readonly resolver: ProductResolverPort,
    ) { }

    async mapToDomain(externalOrder: any, marketplaceId: string): Promise<any> {
        const items: any[] = externalOrder.items || [];

        // 1. Batch-resolve product IDs for all items at once (via port)
        const batchInput = items.map((i: any) => ({
            externalItemId: String(i.id || i.item_id || ''),
            sku: i.sku || '',
            title: i.title,
        }));

        const matchMap = await this.resolver.resolveProducts(batchInput, marketplaceId);

        // 2. Collect resolved product IDs and batch-load costPrice in a single query (via port)
        const validEntries: Array<{ idx: number; pId: string }> = [];
        for (const [idx, pId] of matchMap.entries()) {
            if (pId && Types.ObjectId.isValid(pId)) {
                validEntries.push({ idx, pId });
            }
        }

        let costPriceMap = new Map<string, number>();
        if (validEntries.length > 0) {
            const productIds = validEntries.map(e => e.pId);
            costPriceMap = await this.resolver.getCostPrices(productIds);
        }

        // 3. Build resolved items
        const resolvedItems = items.map((i: any, idx: number) => {
            const pId = matchMap.get(idx) ?? null;
            const isValid = !!(pId && Types.ObjectId.isValid(pId));
            return {
                externalId: batchInput[idx].externalItemId,
                sku: batchInput[idx].sku || undefined,
                asin: i.asin || undefined,
                title: i.title,
                quantity: i.quantity,
                unitPrice: i.unit_price,
                costPriceAtSale: isValid ? (costPriceMap.get(pId) ?? 0) : 0,
                productId: isValid ? new Types.ObjectId(pId) : null,
            };
        });

        // 4. Map Payment — extract all cost breakdown fields from marketplace data
        let paymentInfo: any = {
            method: 'unknown',
            marketplaceFee: 0,
            netAmount: 0,
            grossAmount: 0,
            couponAmount: 0,
            taxAmount: 0,
            installments: 1,
            authorizationCode: '',
        };

        if (externalOrder.payments && externalOrder.payments.length > 0) {
            const payment = externalOrder.payments.find((p: any) => p.status === 'approved') || externalOrder.payments[0];
            if (payment) {
                // ML provides marketplace_fee directly; fallback to fee_details sum or manual diff
                const fee = payment.marketplace_fee
                    ?? (payment.fee_details?.reduce((acc: number, f: any) => acc + (f.amount || 0), 0))
                    ?? Math.max(0, (payment.transaction_amount || 0) - (payment.net_received_amount || payment.transaction_amount || 0));

                paymentInfo = {
                    method: payment.payment_method_id || payment.payment_type || 'unknown',
                    marketplaceFee: Number(fee) || 0,
                    netAmount: payment.net_received_amount || payment.net_amount || payment.transaction_amount || 0,
                    grossAmount: payment.total_paid_amount || payment.transaction_amount || externalOrder.total_amount || 0,
                    couponAmount: payment.coupon_amount || 0,
                    taxAmount: payment.taxes_amount || 0,
                    installments: payment.installments || 1,
                    authorizationCode: payment.authorization_code || '',
                };
            }
        }

        // 5. Map Customer + Address
        const buyer = externalOrder.buyer || {};
        const phone = (typeof buyer.phone === 'object' ? buyer.phone?.number : buyer.phone) || '';

        // Resolve shipping/receiver address if available (from ML shipment details or Shopee)
        const rawAddr = buyer.address || externalOrder.shipping_address || externalOrder.recipient_address || {};
        const customerAddress = {
            zipCode: rawAddr.zip_code || rawAddr.zipCode || rawAddr.receiver_zip_code || '',
            street: rawAddr.street || rawAddr.street_name || rawAddr.full_address || '',
            number: String(rawAddr.number || rawAddr.street_number || rawAddr.house_number || ''),
            neighborhood: rawAddr.neighborhood || rawAddr.neighborhood?.name || rawAddr.district || '',
            city: rawAddr.city || rawAddr.city?.name || rawAddr.town || '',
            state: (rawAddr.state || rawAddr.state?.id || rawAddr.province || '').replace('BR-', ''),
        };

        return {
            externalId: externalOrder.id || externalOrder.code || externalOrder.order_sn,
            marketplaceId: new Types.ObjectId(marketplaceId),
            status: externalOrder.status,
            totalAmount: externalOrder.total_amount,
            shippingAmount: externalOrder.shipping?.cost || 0,
            syncedAt: new Date(),
            // Data real de criação do pedido no marketplace (date_created). Distinta do
            // createdAt (timestamps = momento da nossa ingestão). Ausente → undefined.
            marketplaceCreatedAt: externalOrder.date_created
                ? new Date(externalOrder.date_created)
                : undefined,
            // ML-specific: pack_id is needed for fiscal document upload
            packId: externalOrder.pack_id ? String(externalOrder.pack_id) : undefined,
            marketplaceTag: externalOrder.marketplaceName || undefined,
            customer: {
                name: buyer.name || `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim() || buyer.nickname || '',
                document: buyer.document || buyer.billing_info?.doc_number || '',
                email: buyer.email || '',
                phone,
                address: customerAddress,
            },
            payment: paymentInfo,
            items: resolvedItems,
        };
    }
}
