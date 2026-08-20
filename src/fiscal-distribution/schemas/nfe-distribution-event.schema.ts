import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NfeDistributionEventDocument = HydratedDocument<NfeDistributionEventModel>;

/**
 * Resumo de NFe emitida CONTRA o CNPJ do emitente (você = destinatário —
 * compra), descoberto via NFeDistribuiçãoDFe. Não confundir com FiscalDocument
 * (NFe de venda emitida por você). Ver Seção 5 da spec de completude do
 * ciclo de vida fiscal.
 */
@Schema({ collection: 'nfe_distribution_events', timestamps: true })
export class NfeDistributionEventModel {
    @Prop({ type: Types.ObjectId, ref: 'LegalEntityModel', required: true, index: true })
    legalEntityId: Types.ObjectId;

    @Prop({ required: true, index: true })
    nsu: string;

    @Prop({ required: true, unique: true, index: true })
    accessKey: string;

    @Prop()
    xml?: string;

    @Prop({ required: true })
    emitterCnpj: string;

    @Prop()
    emitterName?: string;

    @Prop()
    issueDate?: Date;

    @Prop({
        enum: ['PENDING', 'ACKNOWLEDGED', 'CONFIRMED', 'UNKNOWN', 'NOT_REALIZED'],
        default: 'PENDING',
    })
    manifestationStatus: string;

    @Prop()
    manifestedAt?: Date;

    @Prop({ type: Types.ObjectId, ref: 'FiscalEntryModel' })
    importedEntryId?: Types.ObjectId;
}

export const NfeDistributionEventSchema = SchemaFactory.createForClass(NfeDistributionEventModel);

export type NfeDistributionCursorDocument = HydratedDocument<NfeDistributionCursorModel>;

@Schema({ collection: 'nfe_distribution_cursor' })
export class NfeDistributionCursorModel {
    @Prop({ type: Types.ObjectId, ref: 'LegalEntityModel', required: true, unique: true, index: true })
    legalEntityId: Types.ObjectId;

    @Prop({ required: true, default: '0' })
    lastNsu: string;
}

export const NfeDistributionCursorSchema = SchemaFactory.createForClass(NfeDistributionCursorModel);
