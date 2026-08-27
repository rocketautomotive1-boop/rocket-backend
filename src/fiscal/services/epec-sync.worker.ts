import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FiscalDocumentModel, FiscalDocumentDocument } from '../schemas/fiscal.schema';
import { LegalEntityDocument } from '../../legal-entity/schemas/legal-entity.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { SefazService } from './sefaz.service';
import { FiscalService } from './fiscal.service';

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
        private readonly fiscalService: FiscalService,
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
        if (!relevant.length) {
            // Sem nenhuma NFe presa em AUTHORIZED_CONTINGENCY não há nada para o fluxo
            // de confirmação abaixo processar — mas isso não significa que a SEFAZ ainda
            // está fora do ar: pode ser que o EPEC em si nunca tenha funcionado (bug de
            // transporte, por exemplo), então nenhuma nota chegou a esse status. Sem este
            // probe direto, contingencyMode ficaria travado em true para sempre nesse
            // cenário, mesmo com a SEFAZ já respondendo normalmente (confirmado ao vivo em
            // produção, pedido 2000018139210232 — a SEFAZ-PE já respondia consultas
            // normalmente enquanto o EPEC seguia dando erro de transporte).
            await this.probeAndExitIfOnline(entity);
            return;
        }

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

                    // Sem isso, uma NFe emitida via EPEC nunca disparava o anexo automático
                    // ao Mercado Livre (FiscalMlAttachListener), o DANFE (FiscalDanfeService)
                    // nem a notificação — todos escutam NFE_AUTHORIZED, que só era emitido no
                    // fluxo de emissão normal (fiscal.service.ts emitPostEmissionEvent), nunca
                    // aqui na confirmação pós-contingência.
                    this.fiscalService.emitAuthorizedEvent(nfe);
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

    /** Sonda o serviço de status da SEFAZ diretamente (NfeStatusServico4) quando não há
     *  nenhuma NFe AUTHORIZED_CONTINGENCY para usar como sinal de confirmação. Mesmo
     *  streak de sucessos consecutivos do fluxo normal, para não sair de contingência
     *  por uma resposta isolada (SEFAZ instável, caindo e voltando). */
    private async probeAndExitIfOnline(entity: LegalEntityDocument): Promise<void> {
        const { online } = await this.sefazService.checkStatus(entity, 'PRODUCTION').catch(() => ({ online: false }));
        if (!online) {
            await this.legalEntityService.updateContingencyState(entity._id, { contingencySuccessCount: 0 });
            return;
        }

        const newStreak = (entity.contingencySuccessCount || 0) + 1;
        if (newStreak >= SUCCESS_STREAK_TO_EXIT_CONTINGENCY) {
            await this.legalEntityService.updateContingencyState(entity._id, {
                contingencyMode: false,
                contingencyConsecutiveFailures: 0,
                contingencySuccessCount: 0,
            });
            this.logger.log(`LegalEntity ${entity.companyName} saiu de contingência via probe de status — SEFAZ normalizada.`);
        } else {
            await this.legalEntityService.updateContingencyState(entity._id, { contingencySuccessCount: newStreak });
        }
    }
}
