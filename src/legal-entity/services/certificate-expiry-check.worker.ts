import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LegalEntityModel, LegalEntityDocument } from '../schemas/legal-entity.schema';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

const WARNING_DAYS = [30, 15, 7];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Certificados A1 duram 1 ano e vencem silenciosamente hoje, parando a emissão
 * fiscal sem aviso. Roda diariamente e notifica com antecedência de 30/15/7
 * dias — dedup pelo próprio NotificationPipeline (deduplicationKey por dia).
 */
@Injectable()
export class CertificateExpiryCheckWorker {
    private readonly logger = new Logger(CertificateExpiryCheckWorker.name);

    constructor(
        @InjectModel(LegalEntityModel.name)
        private readonly legalEntityModel: Model<LegalEntityDocument>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @Cron('0 0 8 * * *')
    async checkExpiringCertificates(): Promise<void> {
        const entities = await this.legalEntityModel
            .find({ isActive: true, certificateValidUntil: { $exists: true, $ne: null } })
            .exec();

        const today = this.startOfDay(new Date());

        for (const entity of entities) {
            const validUntil = this.startOfDay(entity.certificateValidUntil!);
            const daysRemaining = Math.round((validUntil.getTime() - today.getTime()) / MS_PER_DAY);

            if (!WARNING_DAYS.includes(daysRemaining)) continue;

            this.logger.warn(`Certificado de ${entity.companyName} (${entity.cnpj}) vence em ${daysRemaining} dia(s).`);
            this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
                type: 'fiscal.certificate.expiring',
                aggregateType: 'fiscal',
                aggregateId: String(entity._id),
                title: 'Certificado digital vencendo',
                body: `O certificado de ${entity.companyName} vence em ${daysRemaining} dia(s). Renove para não interromper a emissão de NFe.`,
                severity: daysRemaining <= 7 ? 'error' : 'warning',
                deduplicationKey: `fiscal.certificate.expiring:${entity._id}:${daysRemaining}`,
                audience: { kind: 'all-admins' },
                data: { legalEntityId: String(entity._id), daysRemaining },
            });
        }
    }

    private startOfDay(date: Date): Date {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }
}
