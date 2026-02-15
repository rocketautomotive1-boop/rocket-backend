import { Injectable } from '@nestjs/common';
import { ProductMatcherService } from '../../product/services/product-matcher.service';
import { ProductService } from '../../product/product.service';
import { Types } from 'mongoose';

@Injectable()
export class OrderMapperService {

    constructor(
        private readonly productMatcher: ProductMatcherService,
        private readonly productService: ProductService
    ) { }

    async mapToDomain(externalOrder: any, marketplaceId: string): Promise<any> {
        // 1. Resolve Items
        const resolvedItems = await Promise.all((externalOrder.items || []).map(async (i: any) => {
            const externalItemId = String(i.id || i.item_id || '');
            const sku = i.sku || '';

            const pId = await this.productMatcher.resolveProduct(externalItemId, sku, marketplaceId);
            const isValidPId = pId && Types.ObjectId.isValid(pId);

            let costPrice = 0;
            if (isValidPId) {
                // Determine cost price at the moment of sale
                // We use findByIdClean or findById from service
                // Assuming ProductService has findById or similar. 
                // To avoid circular dependency issues if ProductService depends on OrderModule, 
                // we might need to use ProductRepository directly or rely on forwardRef if injected.
                // Assuming ProductService is available via forwardRef if needed in Module.
                try {
                    const product = await this.productService.findOne(pId);
                    if (product) {
                        // Parse Decimal128 or number
                        costPrice = product.costPrice ? Number(product.costPrice.toString()) : 0;
                    }
                } catch (e) { }
            }

            return {
                externalId: externalItemId,
                title: i.title,
                quantity: i.quantity,
                unitPrice: i.unit_price,
                costPriceAtSale: costPrice,
                productId: isValidPId ? new Types.ObjectId(pId) : null, // Consolidated field
            };
        }));

        // 2. Map Payment
        let paymentInfo = {
            method: 'unknown',
            marketplaceFee: 0,
            netAmount: 0,
            installments: 1
        };

        if (externalOrder.payments && externalOrder.payments.length > 0) {
            // Aggregate payments if multiple, or pick main one
            const payment = externalOrder.payments.find((p: any) => p.status === 'approved') || externalOrder.payments[0];
            if (payment) {
                paymentInfo = {
                    method: payment.payment_method_id || payment.payment_type || 'unknown',
                    // Calculate fees if provided, or assume 0 for now until explicitly mapped from specific marketplace payload
                    marketplaceFee: payment.fee_details ? payment.fee_details.reduce((acc, f) => acc + (f.amount || 0), 0) : (payment.transaction_amount - (payment.net_received_amount || payment.transaction_amount)),
                    netAmount: payment.net_received_amount || payment.transaction_amount || 0,
                    installments: payment.installments || 1
                };
            }
        }

        // 3. Map Customer
        const buyer = externalOrder.buyer || {};
        const phone = (typeof buyer.phone === 'object' ? buyer.phone?.number : buyer.phone) || '';

        return {
            externalId: externalOrder.id || externalOrder.code,
            marketplaceId: new Types.ObjectId(marketplaceId),
            status: externalOrder.status,
            totalAmount: externalOrder.total_amount,
            shippingAmount: externalOrder.shipping?.cost || 0,
            syncedAt: new Date(),
            customer: {
                name: buyer.name,
                document: buyer.document || buyer.billing_info?.doc_number || '',
                email: buyer.email,
                phone: phone,
                address: { // TODO: Map real address if available in payload
                    zipCode: '', street: '', number: '', neighborhood: '', city: '', state: ''
                }
            },
            payment: paymentInfo,
            items: resolvedItems
        };
    }
}
