import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LegalEntityDocument = HydratedDocument<LegalEntityModel>;

/**
 * Entidade legal emissora (empresa/CNPJ). Dados imutáveis por natureza — não
 * variam por canal de venda. Série/contador/sellerId por marketplace vivem em
 * Store.fiscalChannels[], não aqui. Ver
 * docs/superpowers/specs/2026-08-19-store-fiscal-legalentity-design.md.
 */
@Schema({ collection: 'legal_entities', timestamps: true })
export class LegalEntityModel {
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

    /** Validade do certificado digital, extraída em POST /legal-entities/inspect-certificate.
     *  Alimenta CertificateExpiryCheckWorker (aviso 30/15/7 dias antes de vencer). */
    @Prop()
    certificateValidUntil?: Date;

    /**
     * Código de Segurança do Contribuinte (CSC) — credencial fornecida pela SEFAZ do
     * estado do emitente (portal do contribuinte), usada para compor o hash SHA-1 da
     * URL do QR Code de consulta do DANFE (obrigatório desde NFe 4.00). Sem isso o
     * DANFE não pode gerar um QR Code oficialmente válido — sai sem QR Code em vez de
     * um QR Code com hash incorreto.
     */
    @Prop()
    csc?: string;

    @Prop()
    cscId?: string; // idToken do CSC (identifica qual token está ativo na SEFAZ)

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

    /** Ciência automática (evento 210210) ao descobrir NFe via Distribuição DFe —
     *  evita vencer prazo legal de manifestação por esquecimento. Confirmação/
     *  Desconhecimento/Não Realizada continuam sempre manuais. */
    @Prop({ default: true })
    autoAcknowledge: boolean;

    /**
     * EPEC (Emissão em Contingência) — ativado quando falhas de transporte
     * consecutivas com a SEFAZ ultrapassam o limiar (FISCAL_TRANSPORT_FAILURE_THRESHOLD).
     * Persistido (não é estado local do worker) para sobreviver a restart.
     * Desligado após N transmissões normais bem-sucedidas consecutivas
     * (contingencySuccessCount), evita flapping se a SEFAZ estiver instável.
     */
    @Prop({ default: false })
    contingencyMode: boolean;

    @Prop({ default: 0 })
    contingencyConsecutiveFailures: number;

    @Prop({ default: 0 })
    contingencySuccessCount: number;
}

export const LegalEntitySchema = SchemaFactory.createForClass(LegalEntityModel);
