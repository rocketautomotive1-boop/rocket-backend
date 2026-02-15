import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FinancialTransactionModel, FinancialTransactionSchema } from './schemas/financial-transaction.schema';
import { FinancialService } from './services/financial.service';
import { FinancialController } from './controllers/financial.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: FinancialTransactionModel.name, schema: FinancialTransactionSchema },
        ])
    ],

    controllers: [FinancialController],
    providers: [FinancialService],
    exports: [FinancialService]
})
export class FinancialModule { }
