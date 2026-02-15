import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FiscalIssuerDocument = HydratedDocument<FiscalIssuerModel>;
export type FiscalDocumentDocument = HydratedDocument<FiscalDocumentModel>;

// --- Fiscal Issuer (Company Config) ---

@Schema({ collection: 'fiscal_issuers', timestamps: true })
export class FiscalIssuerModel {
    @Prop({ required: true })
    cnpj: string;

    @Prop({ required: true })
    ie: string;

    @Prop({ required: true })
    companyName: string;

    @Prop({ required: true })
    fantasyName: string;

    @Prop({ default: 'SIMPLES_NACIONAL' })
    taxRegime: string;

    @Prop({ default: 0 })
    lastNfeNumber: number;

    @Prop({ default: 1 })
    nfeSeries: number;

    @Prop()
    certificatePfx: string; // Base64 or Path

    @Prop()
    certificatePassword: string;

    @Prop({ type: Object })
    address: {
        street: string;
        number: string;
        neighborhood: string;
        city: string;
        state: string;
        zipCode: string;
        ibgeCode: string;
        phone?: string;
    };

    @Prop({ default: true })
    isActive: boolean;


}

export const FiscalIssuerSchema = SchemaFactory.createForClass(FiscalIssuerModel);

// --- Fiscal Document (NFe) ---

@Schema({ collection: 'fiscal_documents', timestamps: true })
export class FiscalDocumentModel {
    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    order?: Types.ObjectId;

    @Prop({ required: true, index: true })
    orderId: string; // Marketplace Order ID (String)

    @Prop()
    internalOrderId: number; // Keep legacy ID just in case

    @Prop({ default: 1 })
    series: number;

    @Prop()
    number: number;

    @Prop({ index: true })
    accessKey: string;

    @Prop()
    xml: string;

    @Prop()
    xmlSigned: string;

    @Prop()
    protocol: string;

    @Prop({ default: 'DRAFT', index: true })
    status: string;

    @Prop({ default: 'HOMOLOGATION' })
    environment: string;

    @Prop()
    rejectionReason: string;

    @Prop({ type: Object })
    issuer: any; // Snapshot of FiscalIssuer


}

export const FiscalDocumentSchema = SchemaFactory.createForClass(FiscalDocumentModel);
