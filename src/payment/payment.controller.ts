import { Controller, Post, Body } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payments')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) { }

    @Post('webhook')
    handleWebhook(@Body() payload: any) {
        console.log('Payment Webhook received:', payload);
        return { received: true };
    }
}
