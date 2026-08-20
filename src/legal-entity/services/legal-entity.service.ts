import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LegalEntityModel, LegalEntityDocument } from '../schemas/legal-entity.schema';

@Injectable()
export class LegalEntityService {
    private readonly logger = new Logger(LegalEntityService.name);

    constructor(
        @InjectModel(LegalEntityModel.name)
        private readonly legalEntityModel: Model<LegalEntityDocument>,
    ) { }

    async findById(id: string | Types.ObjectId | null | undefined): Promise<LegalEntityDocument> {
        if (!id || !Types.ObjectId.isValid(id)) {
            throw new NotFoundException('Loja sem entidade legal emissora configurada.');
        }
        const entity = await this.legalEntityModel.findById(id).exec();
        if (!entity) throw new NotFoundException(`Entidade legal ${id} não encontrada.`);
        return entity;
    }

    /** Atalho para telas de configuração — válido apenas enquanto existe uma única LegalEntity. */
    async findActive(): Promise<LegalEntityDocument | null> {
        return this.legalEntityModel.findOne({ isActive: true }).exec();
    }

    async findAllInContingency(): Promise<LegalEntityDocument[]> {
        return this.legalEntityModel.find({ contingencyMode: true }).exec();
    }

    async saveActive(data: Partial<LegalEntityModel>): Promise<LegalEntityDocument> {
        if (data.taxRegime !== undefined) {
            const raw = String(data.taxRegime).toUpperCase().replace(/[^A-Z0-9]/g, '');
            const SIMPLES_VARIANTS = ['SIMPLESNACIONAL', 'SIMPLES', 'SN', '1', 'SIMPLESNACIOANL'];
            if (SIMPLES_VARIANTS.includes(raw)) {
                data.taxRegime = 'SIMPLES_NACIONAL';
            }
        }
        const entity = await this.legalEntityModel.findOneAndUpdate(
            { isActive: true },
            data,
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).exec();
        this.logger.log(`LegalEntity saved. taxRegime=${entity?.taxRegime}`);
        return entity;
    }

    /** Usado por EPEC (Seção 8) — atualiza estado de contingência sem passar pelo
     *  formulário de configuração completo. Retorna o doc atualizado para o
     *  chamador decidir a próxima ação (ex.: se acabou de entrar em contingência). */
    async updateContingencyState(id: Types.ObjectId | string, data: {
        contingencyMode?: boolean;
        contingencyConsecutiveFailures?: number;
        contingencySuccessCount?: number;
    }): Promise<LegalEntityDocument> {
        const entity = await this.legalEntityModel.findByIdAndUpdate(id, { $set: data }, { new: true }).exec();
        if (!entity) throw new NotFoundException(`Entidade legal ${id} não encontrada.`);
        return entity;
    }
}
