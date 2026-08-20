import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FiscalDocumentModel, FiscalDocumentDocument } from '../schemas/fiscal.schema';
import { LegalEntityDocument } from '../../legal-entity/schemas/legal-entity.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { SefazService } from './sefaz.service';

const SUCCESS_STREAK_TO_EXIT_CONTINGENCY = 3;

/**
 * Sincroniza NFes emitidas em contingência (AUTHORIZED_CONTINGENCY) assim que
 * a SEFAZ do emitente volta a responder normalmente, transmitindo-as pelo
 * fluxo normal de autorização para obter o protocolo definitivo. Desliga
 * contingencyMode após N sucessos consecutivos — evita flapping se a SEFAZ
 * estiver instável (caindo e voltando repetidamente).
 */
@Injectable()
export class EpecSyncWorker {
    private readonly logger = new Logger(EpecSyncWorker.name);

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private readonly fiscalDocumentModel: Model<FiscalDocumentDocument>,
        private readonly legalEntityService: LegalEntityService,
        private readonly sefazService: SefazService,
    ) { }

    @Cron('*/10 * * * *') // a cada 10 minutos — mais frequente que o poll de Distribuição DFe (sem rate-limit oficial para authorize())
    async syncPendingContingencyNFes(): Promise<void> {
        const entitiesInContingency = await this.legalEntityService.findAllInContingency();
        for (const entity of entitiesInContingency) {
            await this.syncForEntity(entity).catch((err) =>
                this.logger.error(`Sync EPEC falhou para ${entity._id}: ${err.message}`),
            );
        }
    }

    private async syncForEntity(entity: LegalEntityDocument): Promise<void> {
        const pending = await this.fiscalDocumentModel
            .find({ storeId: { $exists: true }, status: 'AUTHORIZED_CONTINGENCY' })
            .limit(20)
            .exec();

        // Filtra pelas notas cujo issuer snapshot bate com esta LegalEntity (issuer é
        // gravado como snapshot no momento da emissão — não há FK direta aqui).
        const relevant = pending.filter((nfe: any) => nfe.issuer?.cnpj === entity.cnpj);
        if (!relevant.length) return;

        let successCount = 0;
        for (const nfe of relevant) {
            try {
                const signedXml = nfe.xml; // já assinado (contingência guarda o XML assinado original)
                const result = await this.sefazService.authorize(signedXml, nfe.environment, entity);
                if (result.status === 'authorized') {
                    (nfe as any).status = 'AUTHORIZED';
                    (nfe as any).protocol = result.protocol;
                    if (result.protNFeXml) {
                        const cleanSigned = signedXml.replace(/<\?xml[^?]*\?>/g, '').trim();
                        (nfe as any).xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${cleanSigned}${result.protNFeXml}</nfeProc>`;
                    }
                    await nfe.save();
                    successCount++;
                    this.logger.log(`NFe ${nfe.accessKey} sincronizada pós-contingência (protocolo ${result.protocol}).`);
                }
            } catch (err: any) {
                this.logger.warn(`Sincronização de NFe ${nfe.accessKey} ainda falhando: ${err.message}`);
                successCount = 0; // qualquer falha reseta a sequência de sucesso desta rodada
                break; // SEFAZ provavelmente ainda indisponível — não adianta tentar as próximas
            }
        }

        if (successCount === 0) return;

        const newStreak = (entity.contingencySuccessCount || 0) + successCount;
        if (newStreak >= SUCCESS_STREAK_TO_EXIT_CONTINGENCY) {
            await this.legalEntityService.updateContingencyState(entity._id, {
                contingencyMode: false,
                contingencyConsecutiveFailures: 0,
                contingencySuccessCount: 0,
            });
            this.logger.log(`LegalEntity ${entity.companyName} saiu de contingência — SEFAZ normalizada.`);
        } else {
            await this.legalEntityService.updateContingencyState(entity._id, { contingencySuccessCount: newStreak });
        }
    }
}
