import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NfeDistributionEventModel, NfeDistributionEventDocument } from '../schemas/nfe-distribution-event.schema';
import { LegalEntityModel, LegalEntityDocument } from '../../legal-entity/schemas/legal-entity.schema';
import { NfeManifestacaoClient, ManifestationType } from './nfe-manifestacao.client';
import { NfeDistribuicaoClient } from './nfe-distribuicao.client';
import { NfeImportService } from '../../fiscal/services/nfe-import.service';

const MANIFESTATION_STATUS_BY_TYPE: Record<ManifestationType, string> = {
    CONFIRMATION: 'CONFIRMED',
    ACKNOWLEDGMENT: 'ACKNOWLEDGED',
    UNKNOWN: 'UNKNOWN',
    NOT_REALIZED: 'NOT_REALIZED',
};

@Injectable()
export class FiscalDistributionService {
    private readonly logger = new Logger(FiscalDistributionService.name);

    constructor(
        @InjectModel(NfeDistributionEventModel.name)
        private readonly eventModel: Model<NfeDistributionEventDocument>,
        @InjectModel(LegalEntityModel.name)
        private readonly legalEntityModel: Model<LegalEntityDocument>,
        private readonly manifestacaoClient: NfeManifestacaoClient,
        private readonly distribuicaoClient: NfeDistribuicaoClient,
        private readonly nfeImportService: NfeImportService,
    ) { }

    async list(status?: string) {
        const filter = status ? { manifestationStatus: status } : {};
        return this.eventModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    async manifest(eventId: string, type: ManifestationType, justification?: string) {
        const event = await this.eventModel.findById(eventId).exec();
        if (!event) throw new NotFoundException(`Evento de distribuição ${eventId} não encontrado.`);

        const entity = await this.legalEntityModel.findById(event.legalEntityId).exec();
        if (!entity?.certificatePfx) throw new BadRequestException('Entidade legal sem certificado configurado.');

        const result = await this.manifestacaoClient.manifest({
            accessKey: event.accessKey,
            cnpj: entity.cnpj,
            type,
            justification,
            certificatePfx: entity.certificatePfx,
            certificatePassword: entity.certificatePassword,
            environment: 'PRODUCTION',
        });

        if (result.status !== 'registered') {
            throw new BadRequestException(`SEFAZ rejeitou a manifestação: ${result.cStat} - ${result.message}`);
        }

        event.manifestationStatus = MANIFESTATION_STATUS_BY_TYPE[type];
        event.manifestedAt = new Date();
        await event.save();

        return { status: event.manifestationStatus, protocol: result.protocol };
    }

    /** Baixa o XML completo (pós-manifestação) e alimenta o mesmo fluxo de
     *  importação usado pelo upload manual — sem caminho duplicado. */
    async importXml(eventId: string) {
        const event = await this.eventModel.findById(eventId).exec();
        if (!event) throw new NotFoundException(`Evento de distribuição ${eventId} não encontrado.`);
        if (!['ACKNOWLEDGED', 'CONFIRMED'].includes(event.manifestationStatus)) {
            throw new BadRequestException('Manifeste a NFe (Ciência ou Confirmação) antes de importar o XML completo.');
        }

        const entity = await this.legalEntityModel.findById(event.legalEntityId).exec();
        if (!entity?.certificatePfx) throw new BadRequestException('Entidade legal sem certificado configurado.');

        // NOTA: o protocolo NFeDistribuiçãoDFe tem dois modos de consulta —
        // distNSU (varre a partir de um cursor, o que NfeDistribuicaoClient
        // implementa) e consNSU (busca um NSU específico, que devolve o XML
        // completo procNFe em vez do resumo resNFe). Este método usa distNSU
        // como aproximação (reconsulta a partir do NSU do resumo) — cobre a
        // maioria dos casos porque o procNFe costuma aparecer no mesmo lote
        // logo após o resNFe, mas não é garantido. Se não vier, marca como
        // pendente de nova tentativa em vez de falhar silenciosamente.
        let xml = event.xml;
        if (!xml) {
            const result = await this.distribuicaoClient.consultar({
                cnpj: entity.cnpj,
                uf: entity.address?.state || 'PE',
                ultNsu: event.nsu,
                certificatePfx: entity.certificatePfx,
                certificatePassword: entity.certificatePassword,
                environment: 'PRODUCTION',
            });
            xml = result.xmlByAccessKey.get(event.accessKey);
        }
        if (!xml) {
            throw new BadRequestException(
                'XML completo ainda não disponível nesta consulta (a distribuição só devolveu o resumo). Tente novamente em alguns minutos.',
            );
        }

        const entry = await this.nfeImportService.processXml(xml);
        event.importedEntryId = (entry as any)._id;
        event.xml = xml;
        await event.save();

        return entry;
    }
}
