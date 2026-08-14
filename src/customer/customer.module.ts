import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { OtpService } from './otp.service';
import { ZenviaSmsClient } from './zenvia-sms.client';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerModel, CustomerSchema } from './schemas/customer.schema';
import { OtpModel, OtpSchema } from './schemas/otp.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: CustomerModel.name, schema: CustomerSchema },
            { name: OtpModel.name, schema: OtpSchema },
        ]),
        AuthModule,
        NotificationsModule,
        WhatsAppModule,
    ],
    controllers: [CustomerController],
    providers: [CustomerService, OtpService, ZenviaSmsClient],
    exports: [CustomerService],
})
export class CustomerModule { }
