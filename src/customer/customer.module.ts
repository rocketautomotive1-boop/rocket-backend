import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';

import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerModel, CustomerSchema } from './schemas/customer.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: CustomerModel.name, schema: CustomerSchema }]),
        AuthModule
    ],
    controllers: [CustomerController],
    providers: [CustomerService],
    exports: [CustomerService],
})
export class CustomerModule { }
