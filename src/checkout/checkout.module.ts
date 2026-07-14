import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartModel, CartSchema } from './schemas/cart.schema';
import { CouponRedemptionModel, CouponRedemptionSchema } from './schemas/coupon-redemption.schema';
import { ProductModule } from '../product/product.module';
import { CustomerModule } from '../customer/customer.module';
import { AuthModule } from '../auth/auth.module';

import { CheckoutService } from './checkout.service';
import { CartCleanupService } from './cart-cleanup.service';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { StockModule } from '../stock/stock.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: CartModel.name, schema: CartSchema },
            { name: 'CouponModel', schema: require('./schemas/coupon.schema').CouponSchema },
            { name: CouponRedemptionModel.name, schema: CouponRedemptionSchema },
        ]),
        ProductModule,
        CustomerModule,
        AuthModule,
        PaymentModule,
        LogisticsModule,
        OrderModule,
        StockModule
    ],
    controllers: [CartController],
    providers: [CartService, CheckoutService, CartCleanupService],
    exports: [CartService, CheckoutService]
})
export class CheckoutModule { }
