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

    @Prop({ default: 1 })
    nfeSeries: number;

    @Prop()
    email: string;

    @Prop()
    responsibleContact: string; // Name of technical responsible (for infRespTec)

    @Prop()
    phone: string; // Technical contact phone (for infRespTec, fallback to address.phone)

    @Prop()
    certificatePfx: string; // Base64 or Path

    @Prop()
    certificatePassword: string;

    @Prop({ type: Map, of: Number, default: {} })
    seriesCounters: Map<string, number>; // Per-series NFe counter: { '1': 100, '2': 50 }

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

    /**
     * true  → empresa possui liminar judicial isentando-a do DIFAL (EC 87/2015).
     *         ICMSUFDest será incluído no XML mas com todos os valores zerados.
     * false → empresa recolhe DIFAL normalmente (obrigatório para SN desde 01/01/2023).
     */
    @Prop({ default: false })
    difalExempt: boolean;

    /**
     * Alíquota efetiva sobre a receita (fração 0..1) usada pelo simulador de custos.
     * Simples Nacional → DAS efetivo (ex.: 0.04). Vazio/0 → impostos não calculados por padrão.
     */
    @Prop({ default: 0 })
    effectiveTaxRate: number;

    /**
     * IDs do vendedor em cada marketplace, usados no campo idCadIntTran (infIntermed).
     * Chaves: 'mercado_livre', 'amazon', 'shopee', 'magalu', 'americanas'
     * Valores: ID numérico do vendedor na plataforma (ex: ML → '2417879606')
     */
    @Prop({ type: Object, default: {} })
    marketplaceSellerIds: Record<string, string>;

}

export const FiscalIssuerSchema = SchemaFactory.createForClass(FiscalIssuerModel);

// --- Fiscal Document (NFe) ---

@Schema({ collection: 'fiscal_documents', timestamps: true })
export class FiscalDocumentModel {
    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    order?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    orderId?: Types.ObjectId; // MongoDB ObjectId of the linked order (same as order, kept for query compat)

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
