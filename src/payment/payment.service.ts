import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentService {
    async processPayment(orderId: number, amount: number, paymentMethod: string, cardData?: any) {
        // TODO: Integrate with real gateway (Mercado Pago, Stripe, etc.)
        // For now, simple mock
        console.log(`Processing ${paymentMethod} payment for Order ${orderId}: $${amount}`);

        return {
            success: true,
            transactionId: `TX-${Date.now()}`,
            status: 'approved',
            message: 'Payment processed successfully (MOCK)'
        };
    }
}
