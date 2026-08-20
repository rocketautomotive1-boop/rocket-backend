import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FiscalDocumentDocument = HydratedDocument<FiscalDocumentModel>;
export type FiscalInutilizationDocument = HydratedDocument<FiscalInutilizationModel>;

// --- Fiscal Document (NFe) ---
// Config da empresa emissora vive em legal-entity/schemas/legal-entity.schema.ts.
// Série/contador/sellerId por canal de venda vivem em store/schemas/store.schema.ts (fiscalChannels[]).

@Schema({ _id: false })
export class CceEvent {
    @Prop({ required: true })
    sequence: number;

    @Prop({ required: true })
    text: string;

    @Prop()
    protocol?: string;

    @Prop({ default: () => new Date() })
    createdAt: Date;
}

const CceEventSchema = SchemaFactory.createForClass(CceEvent);

@Schema({ collection: 'fiscal_documents', timestamps: true })
export class FiscalDocumentModel {
    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    order?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    orderId?: Types.ObjectId; // MongoDB ObjectId of the linked order (same as order, kept for query compat)

    @Prop({ type: Types.ObjectId, ref: 'StoreModel', index: true })
    storeId?: Types.ObjectId;

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
    issuer: any; // Snapshot of LegalEntity at emission time

    @Prop()
    danfeUrl?: string;

    @Prop({ type: [CceEventSchema], default: [] })
    cceEvents: CceEvent[];
}

export const FiscalDocumentSchema = SchemaFactory.createForClass(FiscalDocumentModel);

// --- Fiscal Inutilization (faixa de numeração nunca emitida) ---

@Schema({ collection: 'fiscal_inutilizations', timestamps: true })
export class FiscalInutilizationModel {
    @Prop({ type: Types.ObjectId, ref: 'LegalEntityModel', required: true, index: true })
    legalEntityId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'StoreModel', required: true, index: true })
    storeId: Types.ObjectId;

    @Prop({ required: true })
    series: number;

    @Prop({ required: true })
    from: number;

    @Prop({ required: true })
    to: number;

    @Prop({ required: true })
    justification: string;

    @Prop()
    protocol?: string;

    @Prop({ enum: ['AUTHORIZED', 'REJECTED'], default: 'REJECTED' })
    status: string;

    @Prop()
    rejectionReason?: string;
}

export const FiscalInutilizationSchema = SchemaFactory.createForClass(FiscalInutilizationModel);
