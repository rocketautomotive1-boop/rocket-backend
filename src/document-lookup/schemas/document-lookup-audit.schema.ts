import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocumentLookupAuditDocument = HydratedDocument<DocumentLookupAuditModel>;

/**
 * Auditoria de consultas de documento pessoal (CPF) — rastreabilidade exigida
 * pela base legal LGPD (execução de contrato/obrigação legal: cadastro correto
 * do destinatário é exigência da própria emissão fiscal). CNPJ não é dado
 * pessoal (LGPD não se aplica a pessoa jurídica), não precisa de auditoria.
 */
@Schema({ collection: 'document_lookup_audit', timestamps: true })
export class DocumentLookupAuditModel {
    @Prop({ required: true })
    document: string;

    @Prop({ required: true, default: 'emissao_fiscal' })
    purpose: string;

    @Prop()
    lookedUpBy?: string;
}

export const DocumentLookupAuditSchema = SchemaFactory.createForClass(DocumentLookupAuditModel);
