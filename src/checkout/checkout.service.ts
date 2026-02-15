import { Injectable, BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';
import { OrderService } from '../order/order.service';
import { CustomerService } from '../customer/customer.service';
import { PaymentService } from '../payment/payment.service';
import { FreightService } from '../logistics/freight/freight.service';

@Injectable()
export class CheckoutService {
    constructor(
        private cartService: CartService,
        private orderService: OrderService,
        private customerService: CustomerService,
        private paymentService: PaymentService,
        private freightService: FreightService
    ) { }

    async calculateFreight(customerId: number, zipCode?: string) {
        const cart = await this.cartService.findOrCreateCart(customerId);
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

    async processCheckout(customerId: number, checkoutData: { paymentMethod: string, cardData?: any, freightQuoteId?: string, shippingCost?: number }) {
        // 1. Get Cart
        const cart = await this.cartService.findOrCreateCart(customerId);
        if (!cart || cart.items.length === 0) {
            throw new BadRequestException('Carrinho vazio');
        }

        // 2. Validate Stock (Again)
        // TODO: loop items and check availability

        // 3. Calculate Totals
        const subtotal = cart.items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0);
        const shipping = checkoutData.shippingCost || 0;
        const total = subtotal + shipping;

        // 4. Process Payment
        const paymentResult = await this.paymentService.processPayment(0, total, checkoutData.paymentMethod, checkoutData.cardData);

        if (paymentResult.status !== 'approved') {
            throw new BadRequestException('Pagamento recusado');
        }

        // 5. Create Order
        const order = await this.orderService.createDirectOrder(customerId, cart.items, {
            paymentMethod: checkoutData.paymentMethod,
            transactionId: paymentResult.transactionId,
            shippingCost: shipping
        });

        // 6. Clear Cart
        cart.status = 'ordered';
        await cart.save();

        return order;
    }
}
