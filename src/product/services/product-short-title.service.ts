import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductShortTitleModel, ProductShortTitleDocument } from '../schemas/product-short-title.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';

function normalize(text: string): string {
    return text.trim().toLowerCase();
}

/**
 * Único dono de product_short_titles. Substitui Product.displayName por um
 * título curto reutilizável entre produtos, com sinônimos próprios — ver
 * docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
 * Product.subtitle (texto livre, sem sinônimo) NÃO é gerenciado aqui.
 */
@Injectable()
export class ProductShortTitleService {
    constructor(
        @InjectModel(ProductShortTitleModel.name)
        private readonly titleModel: Model<ProductShortTitleDocument>,
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
    ) { }

    /** Resolve um texto digitado (canônico ou sinônimo) para o ProductShortTitle, se existir. */
    async resolve(text: string): Promise<ProductShortTitleDocument | null> {
        const textNormalized = normalize(text || '');
        if (!textNormalized) return null;

        return this.titleModel
            .findOne({ $or: [{ textNormalized }, { synonyms: textNormalized }] })
            .lean<ProductShortTitleDocument>()
            .exec();
    }

    /** Resolve por texto/sinônimo; se não existir, cria um novo title canônico. */
    async createOrGet(text: string): Promise<ProductShortTitleDocument> {
        const existing = await this.resolve(text);
        if (existing) return existing;

        const textNormalized = normalize(text);
        return this.titleModel.create({
            text: text.trim(),
            textNormalized,
            synonyms: [],
            usageCount: 0,
        }) as unknown as ProductShortTitleDocument;
    }

    /**
     * Adiciona um sinônimo a um title existente e propaga (fan-out síncrono)
     * o array atualizado para Product.titleSynonyms de todos os produtos
     * vinculados — evita $lookup no caminho de busca (Atlas Search).
     */
    async addSynonym(titleId: string, synonym: string): Promise<ProductShortTitleDocument> {
        const title = await this.titleModel.findById(titleId).exec();
        if (!title) throw new NotFoundException('Título não encontrado');

        const synonymNormalized = normalize(synonym);
        const updated = await this.titleModel
            .findByIdAndUpdate(titleId, { $addToSet: { synonyms: synonymNormalized } }, { new: true })
            .lean<ProductShortTitleDocument>()
            .exec();

        await this.productModel
            .updateMany(
                { titleId: new Types.ObjectId(titleId) },
                { $set: { titleSynonyms: updated.synonyms } },
            )
            .exec();

        return updated;
    }

    /**
     * Remove um sinônimo de um title e propaga (fan-out síncrono) o array
     * atualizado para Product.titleSynonyms dos produtos vinculados.
     */
    async removeSynonym(titleId: string, synonym: string): Promise<ProductShortTitleDocument> {
        const title = await this.titleModel.findById(titleId).exec();
        if (!title) throw new NotFoundException('Título não encontrado');

        const synonymNormalized = normalize(synonym);
        const updated = await this.titleModel
            .findByIdAndUpdate(titleId, { $pull: { synonyms: synonymNormalized } }, { new: true })
            .lean<ProductShortTitleDocument>()
            .exec();

        await this.productModel
            .updateMany(
                { titleId: new Types.ObjectId(titleId) },
                { $set: { titleSynonyms: updated.synonyms } },
            )
            .exec();

        return updated;
    }

    /**
     * Mescla `sourceId` em `targetId`: produtos do source passam a apontar pro
     * target (titleId + denormalizados), o texto do source vira sinônimo do
     * target (buscas antigas continuam achando), usageCount é somado, e o
     * source é apagado. Usado pra corrigir duplicatas/typos (ex: "Filtro de
     * Òleo" vs "Filtro de Óleo") sem perder o vínculo dos produtos já migrados.
     */
    async merge(sourceId: string, targetId: string): Promise<ProductShortTitleDocument> {
        if (sourceId === targetId) {
            throw new BadRequestException('Não é possível mesclar um título nele mesmo');
        }

        const [source, target] = await Promise.all([
            this.titleModel.findById(sourceId).exec(),
            this.titleModel.findById(targetId).exec(),
        ]);
        if (!source) throw new NotFoundException('Título de origem não encontrado');
        if (!target) throw new NotFoundException('Título de destino não encontrado');

        const targetObjectId = new Types.ObjectId(targetId);
        const sourceObjectId = new Types.ObjectId(sourceId);

        const inheritedSynonyms = [...source.synonyms, source.textNormalized];
        const updatedTarget = await this.titleModel
            .findByIdAndUpdate(
                targetId,
                {
                    $inc: { usageCount: source.usageCount },
                    $addToSet: { synonyms: { $each: inheritedSynonyms } },
                },
                { new: true },
            )
            .lean<ProductShortTitleDocument>()
            .exec();

        await this.productModel
            .updateMany(
                { titleId: sourceObjectId },
                {
                    $set: {
                        titleId: targetObjectId,
                        titleText: updatedTarget.text,
                        titleSynonyms: updatedTarget.synonyms,
                    },
                },
            )
            .exec();

        await this.titleModel.deleteOne({ _id: sourceId }).exec();

        return updatedTarget;
    }

    /** Autocomplete simples (regex) por texto/sinônimo, ordenado por popularidade. */
    async autocomplete(query: string, limit = 10): Promise<ProductShortTitleDocument[]> {
        const q = normalize(query || '');
        if (!q) return [];

        return this.titleModel
            .find({
                $or: [
                    { textNormalized: { $regex: q, $options: 'i' } },
                    { synonyms: { $regex: q, $options: 'i' } },
                ],
            })
            .sort({ usageCount: -1 })
            .limit(limit)
            .lean<ProductShortTitleDocument[]>()
            .exec();
    }
}
