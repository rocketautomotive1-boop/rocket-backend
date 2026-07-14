import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module';
import { OrderModule } from '../order/order.module';

@Module({
    imports: [MercadoPagoModule, OrderModule],
    controllers: [PaymentController],
    providers: [PaymentService],
    exports: [PaymentService],
})
export class PaymentModule { }
