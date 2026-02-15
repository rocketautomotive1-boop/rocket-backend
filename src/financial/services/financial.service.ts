import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FinancialTransactionModel, FinancialTransactionDocument } from '../schemas/financial-transaction.schema';
import { FiscalEntryModel } from '../../fiscal/schemas/fiscal-entry.schema';

@Injectable()
export class FinancialService {
    private readonly logger = new Logger(FinancialService.name);

    constructor(
        @InjectModel(FinancialTransactionModel.name)
        private financialTransactionModel: Model<FinancialTransactionDocument>,
    ) { }

    async createTransaction(data: Partial<FinancialTransactionModel>): Promise<FinancialTransactionDocument> {
        const newTransaction = new this.financialTransactionModel(data);
        return await newTransaction.save();
    }

    async createFromFiscalEntry(entry: FiscalEntryModel & { _id: Types.ObjectId }, session?: any): Promise<void> {
        if (!entry.billing || !entry.billing.installments || entry.billing.installments.length === 0) {
            this.logger.log(`Entry ${entry.accessKey} has no billing installments. Skipping financial generation.`);
            return;
        }

        const transactions = entry.billing.installments.map(inst => ({
            type: 'PAYABLE',
            status: 'PENDING',
            entity: entry.supplier.name,
            entityDocument: entry.supplier.cnpj,
            description: `NF-e ${entry.billing.invoiceNumber} - Parcela ${inst.number}`,
            documentNumber: entry.billing.invoiceNumber,
            amount: inst.value,
            dueDate: new Date(inst.dueDate),
            fiscalEntryId: entry._id,
        }));

        if (session) {
            await this.financialTransactionModel.insertMany(transactions, { session });
        } else {
            await this.financialTransactionModel.insertMany(transactions);
        }

        this.logger.log(`Generated ${transactions.length} financial transactions for Entry ${entry.accessKey}`);
    }

    async findAll(filter: { status?: string; start?: Date; end?: Date }): Promise<FinancialTransactionDocument[]> {
        const query: any = {};

        if (filter.status) {
            query.status = filter.status;
        }

        if (filter.start || filter.end) {
            query.dueDate = {};
            if (filter.start) query.dueDate.$gte = filter.start;
            if (filter.end) query.dueDate.$lte = filter.end;
        }

        return this.financialTransactionModel.find(query).sort({ dueDate: 1 }).exec();
    }
}
