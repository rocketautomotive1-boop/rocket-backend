import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NfeDistribuicaoClient } from './services/nfe-distribuicao.client';
import { NfeManifestacaoClient } from './services/nfe-manifestacao.client';
import { NfeDistributionEventModel, NfeDistributionEventDocument, NfeDistributionCursorModel, NfeDistributionCursorDocument } from './schemas/nfe-distribution-event.schema';
import { LegalEntityModel, LegalEntityDocument } from '../legal-entity/schemas/legal-entity.schema';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';

// Teto oficial da SEFAZ: 1 consulta a cada 20min por CNPJ — não é escolha de
// engenharia, é regra do protocolo NFeDistribuiçãoDFe. Não há webhook: o
// serviço é pull-only por design.
const POLL_INTERVAL_MS = 20 * 60 * 1000;

@Injectable()
export class NfeDistributionPoller implements OnModuleInit {
    private readonly logger = new Logger(NfeDistributionPoller.name);
    private timers = new Map<string, NodeJS.Timeout>();

    constructor(
        @InjectModel(LegalEntityModel.name) private readonly legalEntityModel: Model<LegalEntityDocument>,
        @InjectModel(NfeDistributionEventModel.name) private readonly eventModel: Model<NfeDistributionEventDocument>,
        @InjectModel(NfeDistributionCursorModel.name) private readonly cursorModel: Model<NfeDistributionCursorDocument>,
        private readonly distribuicaoClient: NfeDistribuicaoClient,
        private readonly manifestacaoClient: NfeManifestacaoClient,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    async onModuleInit(): Promise<void> {
        if (process.env.NFE_DISTRIBUTION_POLLER_ENABLED === 'false') {
            this.logger.log('Poller de Distribuição DFe desabilitado via NFE_DISTRIBUTION_POLLER_ENABLED=false');
            return;
        }
        const entities = await this.legalEntityModel.find({ isActive: true, certificatePfx: { $exists: true, $ne: null } }).exec();
        for (const entity of entities) {
            this.runFor(String(entity._id)).catch((e) =>
                this.logger.error(`Poll inicial falhou para ${entity._id}: ${(e as Error).message}`),
            );
        }
    }

    private async runFor(legalEntityId: string): Promise<void> {
        try {
            await this.pollOnce(legalEntityId);
        } catch (err: any) {
            this.logger.error(`Poll de Distribuição DFe falhou para ${legalEntityId}: ${err.message}`);
        } finally {
            const timer = setTimeout(() => this.runFor(legalEntityId), POLL_INTERVAL_MS);
            timer.unref?.();
            this.timers.set(legalEntityId, timer);
        }
    }

    async pollOnce(legalEntityId: string): Promise<{ discovered: number }> {
        const entity = await this.legalEntityModel.findById(legalEntityId).exec();
        if (!entity || !entity.certificatePfx) return { discovered: 0 };

        const cursor = await this.cursorModel.findOne({ legalEntityId: entity._id }).exec();
        const ultNsu = cursor?.lastNsu || '0';
        const uf = entity.address?.state || 'PE';

        const result = await this.distribuicaoClient.consultar({
            cnpj: entity.cnpj,
            uf,
            ultNsu,
            certificatePfx: entity.certificatePfx,
            certificatePassword: entity.certificatePassword,
            environment: 'PRODUCTION',
        });

        let discovered = 0;
        for (const resumo of result.resumos) {
            const already = await this.eventModel.findOne({ accessKey: resumo.accessKey }).exec();
            if (already) continue;

            await this.eventModel.create({
                legalEntityId: entity._id,
                nsu: resumo.nsu,
                accessKey: resumo.accessKey,
                emitterCnpj: resumo.emitterCnpj,
                emitterName: resumo.emitterName,
                issueDate: resumo.issueDate,
                manifestationStatus: 'PENDING',
            });
            discovered++;

            this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
                type: 'fiscal.distribution.new_nfe',
                aggregateType: 'fiscal',
                aggregateId: resumo.accessKey,
                title: 'Nova NFe recebida',
                body: `NFe de ${resumo.emitterName || resumo.emitterCnpj} — chave ${resumo.accessKey.slice(-6)}. Manifestação pendente.`,
                severity: 'info',
                deduplicationKey: `fiscal.distribution.new_nfe:${resumo.accessKey}`,
                audience: { kind: 'all-admins' },
                data: { accessKey: resumo.accessKey },
            });

            if (entity.autoAcknowledge !== false) {
                this.acknowledgeAutomatically(entity, resumo.accessKey).catch((err) =>
                    this.logger.warn(`Ciência automática falhou para ${resumo.accessKey}: ${err.message}`),
                );
            }
        }

        await this.cursorModel.updateOne(
            { legalEntityId: entity._id },
            { $set: { lastNsu: result.maxNsu } },
            { upsert: true },
        ).exec();

        if (discovered > 0) this.logger.log(`Distribuição DFe: ${discovered} nova(s) NFe descoberta(s) para ${entity.companyName}.`);
        return { discovered };
    }

    private async acknowledgeAutomatically(entity: LegalEntityDocument, accessKey: string): Promise<void> {
        const result = await this.manifestacaoClient.manifest({
            accessKey,
            cnpj: entity.cnpj,
            type: 'ACKNOWLEDGMENT',
            certificatePfx: entity.certificatePfx!,
            certificatePassword: entity.certificatePassword,
            environment: 'PRODUCTION',
        });
        if (result.status === 'registered') {
            await this.eventModel.updateOne(
                { accessKey },
                { $set: { manifestationStatus: 'ACKNOWLEDGED', manifestedAt: new Date() } },
            ).exec();
        }
    }
}
