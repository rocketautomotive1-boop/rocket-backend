import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FiscalCustomerModel, FiscalCustomerSchema } from './schemas/fiscal-customer.schema';
import { FiscalCustomerService } from './services/fiscal-customer.service';
import { FiscalCustomerController } from './fiscal-customer.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: FiscalCustomerModel.name, schema: FiscalCustomerSchema }]),
        AuthModule,
    ],
    controllers: [FiscalCustomerController],
    providers: [FiscalCustomerService],
    exports: [FiscalCustomerService],
})
export class FiscalCustomerModule { }
