import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FiscalEntryDocument = HydratedDocument<FiscalEntryModel>;

@Schema()
class FiscalEntryItem {
    @Prop()
    code: string; // Supplier Code

    @Prop()
    description: string;

    @Prop()
    ean: string; // GTIN/EAN

    @Prop()
    ncm: string;

    @Prop()
    cst: string;

    @Prop()
    cfop: string;

    @Prop()
    unit: string; // XML Unit

    @Prop()
    quantityXml: number;

    @Prop()
    quantityPhysical: number; // For Blind Conference

    @Prop()
    valueUnit: number;

    @Prop()
    valueTotal: number;

    // Tax Details
    // Simplified Tax Details (Backward Compatibility)
    // @Prop({ type: Object })
    // taxDetails: {
    //     ipi: number;
    //     icms: number;
    //     icmsSt: number;
    // };

    // Detailed Tax Structure
    @Prop({ type: Object })
    taxes: {
        icms: {
            cst: string;
            origin: string; // Origem da mercadoria
            mode: string; // modBC
            base: number; // vBC
            rate: number; // pICMS
            value: number; // vICMS

            // ST
            modeSt: string; // modBCST
            baseSt: number; // vBCST
            rateSt: number; // pICMSST
            valueSt: number; // vICMSST

            // Dest
            vBCFCP: number;
            pFCP: number;
            vFCP: number;
            vBCFCPST: number;
            pFCPST: number;
            vFCPST: number;
        };
        ipi: {
            cst: string;
            code: string; // clEnq
            base: number; // vBC
            rate: number; // pIPI
            value: number; // vIPI
        };
        pis: {
            cst: string;
            base: number; // vBC
            rate: number; // pPIS
            value: number; // vPIS
        };
        cofins: {
            cst: string;
            base: number; // vBC
            rate: number; // pCOFINS
            value: number; // vCOFINS
        };
        ii: {
            base: number; // vBC
            despAdu: number; // vDespAdu
            value: number; // vII
            iof: number; // vIOF
        };
    };

    @Prop({ default: 0 })
    freight: number;

    @Prop({ default: 0 })
    insurance: number;

    @Prop({ default: 0 })
    discount: number;

    @Prop({ default: 0 })
    otherExpenses: number;

    @Prop({ default: 1 })
    conversionFactor: number;

    @Prop()
    noBrand?: boolean;

    @Prop()
    brand?: string;

    @Prop({ default: 'BRAND_REVIEW', enum: ['BRAND_REVIEW', 'PENDING', 'MAPPED', 'CONFERENCED', 'DIVERGENT', 'SHORTAGE_ACCEPTED', 'PROCESSED'] })
    status: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel' })
    productId: Types.ObjectId;

    @Prop({
        type: [{
            scannedAt: Date,
            quantity: Number,
            userId: String // Optional: if we want to track who scanned
        }],
        default: []
    })
    scanHistory: {
        scannedAt: Date;
        quantity: number;
        userId?: string;
    }[];
}

const FiscalEntryItemSchema = SchemaFactory.createForClass(FiscalEntryItem);

@Schema({ collection: 'fiscal_entries', timestamps: true })
export class FiscalEntryModel {
    @Prop({ required: true, unique: true, index: true })
    accessKey: string;

    @Prop()
    xml: string;

    @Prop({ type: Object })
    supplier: {
        cnpj: string;
        name: string;
        ie: string;
    };

    @Prop()
    issueDate: Date;

    @Prop({ type: [FiscalEntryItemSchema] })
    items: FiscalEntryItem[];

    @Prop({ default: 'BRAND_REVIEW', enum: ['BRAND_REVIEW', 'PENDING', 'VALIDATED', 'PROCESSED'], index: true })
    status: string;

    @Prop({ type: Object })
    billing: {
        invoiceNumber: string;
        originalValue: number;
        netValue: number;
        installments: Array<{
            number: string;
            dueDate: Date;
            value: number;
        }>;
    };

    @Prop({ type: Object })
    operation: {
        nature: string;
        purpose: number;
    };

    @Prop()
    processedAt: Date;
}

export const FiscalEntrySchema = SchemaFactory.createForClass(FiscalEntryModel);
