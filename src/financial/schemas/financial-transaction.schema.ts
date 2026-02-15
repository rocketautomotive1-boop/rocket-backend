import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FinancialTransactionDocument = HydratedDocument<FinancialTransactionModel>;

@Schema({ collection: 'financial_transactions', timestamps: true })
export class FinancialTransactionModel {
    @Prop({ required: true, enum: ['PAYABLE', 'RECEIVABLE'], index: true })
    type: string;

    @Prop({ required: true, enum: ['PENDING', 'PAID', 'CANCELLED'], default: 'PENDING', index: true })
    status: string;

    @Prop({ required: true })
    entity: string; // Supplier or Customer Name

    @Prop()
    entityDocument: string; // CNPJ/CPF

    @Prop({ required: true })
    description: string;

    @Prop()
    documentNumber: string; // NFe Number or Invoice ID

    @Prop({ required: true })
    amount: number;

    @Prop({ required: true })
    dueDate: Date;

    @Prop()
    paymentDate?: Date;

    @Prop({ type: Object })
    metadata?: any;

    @Prop({ type: Types.ObjectId, ref: 'FiscalEntryModel', index: true })
    fiscalEntryId?: Types.ObjectId;
}

export const FinancialTransactionSchema = SchemaFactory.createForClass(FinancialTransactionModel);
