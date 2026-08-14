import { Injectable, BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';
import { OrderLifecycleService } from '../order/lifecycle/order-lifecycle.service';
import { CustomerService } from '../customer/customer.service';
import { PaymentService } from '../payment/payment.service';
import { FreightService } from '../logistics/freight/freight.service';

@Injectable()
export class CheckoutService {
    constructor(
        private cartService: CartService,
        private orderLifecycle: OrderLifecycleService,
        private customerService: CustomerService,
        private paymentService: PaymentService,
        private freightService: FreightService
    ) { }

    async calculateFreight(customerId: string | null, sessionId: string | null, zipCode?: string) {
        const cart = await this.cartService.findOrCreateCart(customerId ?? undefined, sessionId ?? undefined);
        if (!cart.items.length) return [];

        const destinationZip = zipCode; // TODO: Fetch from customer address if not provided

        if (!destinationZip) {
            return []; // Cannot calculate without zip
        }

        // Calculate total weight and dimensions (simple sum for now)
        const totalWeight = cart.items.reduce((acc, item) => acc + ((item as any).product?.weight * item.quantity), 0);

        // Call Freight Service
        const quotes = await this.freightService.getQuotes({
            recipient: {
                postalCode: destinationZip,
                countryCode: 'BR'
            },
            items: [{
                weight: totalWeight > 0 ? totalWeight : 1,
                height: 10,
                width: 10,
                length: 10,
                price: cart.items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0)
            }]
        });

        return quotes;
    }

    async processCheckout(customerId: string, checkoutData: { paymentMethod: string, cardData?: any, payerData?: any, freightQuoteId?: string, shippingCost?: number, shippingAddress?: any }) {
        // 1. Get Customer + Cart
        const customer = await this.customerService.findOne(customerId) as any;
        if (!customer) {
            throw new BadRequestException('Cliente não encontrado');
        }

        const cart = await this.cartService.findOrCreateCart(customerId);
        if (!cart || cart.items.length === 0) {
            throw new BadRequestException('Carrinho vazio');
        }

        // 2. Validate Stock (Again)
        // TODO: loop items and check availability

        // 3. Revalidate coupon (may have expired/been deactivated/hit its limit since it was
        // applied to the cart) — throws before charging anything if it's no longer valid.
        const coupon = await this.cartService.revalidateCouponForCheckout(customerId, cart.couponCode);
        const discountAmount = coupon ? cart.discountAmount : 0;

        // 4. Calculate Totals — discount is subtracted here (previously ignored, charging the
        // full subtotal even when the customer had a coupon applied).
        const subtotal = cart.items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0);
        const shipping = checkoutData.shippingCost || 0;
        const total = Math.max(0, subtotal - discountAmount) + shipping;

        // 5. Process Payment
        const paymentResult = await this.paymentService.processPayment({
            amount: total,
            method: checkoutData.paymentMethod,
            cardData: checkoutData.cardData,
            payer: { email: customer.email, name: customer.name, document: customer.document, ...checkoutData.payerData },
            externalReference: `cart-${cart._id}`,
        });

        if (paymentResult.status === 'rejected') {
            throw new BadRequestException(paymentResult.message || 'Pagamento recusado');
        }

        // 6. Create Order (status reflects payment: PAID for approved card/pix instant capture,
        // PENDING for pix/boleto awaiting confirmation via webhook)
        const order = await this.orderLifecycle.createDirectOrder(customer, cart.items, {
            paymentMethod: checkoutData.paymentMethod,
            transactionId: paymentResult.transactionId,
            mpStatus: paymentResult.status,
            shippingCost: shipping,
            discountAmount,
            shippingAddress: checkoutData.shippingAddress,
        });

        if (paymentResult.status === 'approved') {
            order.status = 'PAID';
            await order.save();
        }

        // 7. Redeem coupon (usedCount + per-customer record) — only after the order exists,
        // so a coupon that was merely tested and never bought never consumes the limit.
        if (coupon) {
            await this.cartService.redeemCoupon(coupon, customerId, String((order as any)._id));
        }

        // 8. Clear Cart
        cart.status = 'ordered';
        await cart.save();

        return {
            order,
            payment: {
                status: paymentResult.status,
                transactionId: paymentResult.transactionId,
                qrCode: paymentResult.qrCode,
                qrCodeBase64: paymentResult.qrCodeBase64,
                ticketUrl: paymentResult.ticketUrl,
            },
        };
    }
}
