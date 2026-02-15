import { Controller, Get, Query } from '@nestjs/common';
import { FinancialService } from '../services/financial.service';
import { FinancialTransactionModel, FinancialTransactionDocument } from '../schemas/financial-transaction.schema';

@Controller('financial')
export class FinancialController {
    constructor(private readonly financialService: FinancialService) { }

    @Get('transactions')
    async findAll(
        @Query('status') status?: string,
        @Query('start') start?: string,
        @Query('end') end?: string
    ): Promise<FinancialTransactionDocument[]> {
        return this.financialService.findAll({ status, start: start ? new Date(start) : undefined, end: end ? new Date(end) : undefined });
    }
}
