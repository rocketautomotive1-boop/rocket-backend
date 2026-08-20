import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FiscalCustomerDocument = HydratedDocument<FiscalCustomerModel>;

@Schema({ _id: false })
export class FiscalCustomerAddress {
    @Prop() street: string;
    @Prop() number: string;
    @Prop() complement?: string;
    @Prop() neighborhood: string;
    @Prop() city: string;
    @Prop() state: string;
    @Prop() zipCode: string;
}

const FiscalCustomerAddressSchema = SchemaFactory.createForClass(FiscalCustomerAddress);

/**
 * Cadastro fiscal reutilizável por documento (CPF/CNPJ) — separado do
 * Customer B2C (login/storefront), porque a maioria dos pedidos vem de
 * marketplace sem login. Alimentado como efeito colateral do primeiro uso em
 * FiscalService.prepareNFeData, não é uma tela de cadastro própria. Ver
 * Seção 2 da spec de completude do ciclo de vida fiscal.
 */
@Schema({ collection: 'fiscal_customers', timestamps: true })
export class FiscalCustomerModel {
    @Prop({ required: true, unique: true, index: true })
    document: string; // CPF ou CNPJ, só dígitos

    @Prop({ required: true, enum: ['CPF', 'CNPJ'] })
    documentType: string;

    @Prop({ required: true })
    name: string;

    @Prop()
    ie?: string;

    @Prop({ enum: ['CONTRIBUTOR', 'EXEMPT', 'NON_CONTRIBUTOR'], default: 'NON_CONTRIBUTOR' })
    ieIndicator: string;

    @Prop()
    email?: string;

    @Prop()
    phone?: string;

    @Prop({ type: [FiscalCustomerAddressSchema], default: [] })
    addresses: FiscalCustomerAddress[];

    @Prop({ default: () => new Date() })
    lastUsedAt: Date;

    @Prop({ default: 0 })
    ordersCount: number;
}

export const FiscalCustomerSchema = SchemaFactory.createForClass(FiscalCustomerModel);
