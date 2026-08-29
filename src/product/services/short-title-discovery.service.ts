import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import { ProductShortTitleModel, ProductShortTitleDocument } from '../schemas/product-short-title.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { PRODUCT_SECTION_EVENTS, ProductTitleIdResolvedEvent } from '../events/product-section-saved.event';

interface ShortTitleSearchHit {
    _id: Types.ObjectId;
    text: string;
    synonyms: string[];
    score: number;
}

// Conectivos comuns em títulos de marketplace pt-BR — não carregam sinal de
// categoria, então não devem ocupar posição no boost por palavra-núcleo.
const STOPWORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'para', 'com', 'em', 'a', 'o']);

// Boost decrescente por posição: a primeira palavra relevante do título costuma
// carregar o sinal mais forte sobre a peça (ex: "Airbag" em "Airbag de Volante
// Toro 2016-2021"), enquanto qualificadores mais tarde no texto (posição, lado,
// aplicação) não devem competir de igual pra igual no score do Atlas Search.
const POSITIONAL_BOOSTS = [3, 2];
const MAX_BOOSTED_WORDS = POSITIONAL_BOOSTS.length;

export function buildPositionalBoostClauses(titleText: string): Array<{ text: { query: string; path: string[]; score: { boost: { value: number } } } }> {
    const words = titleText
        .trim()
        .split(/\s+/)
        .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));

    return words.slice(0, MAX_BOOSTED_WORDS).map((word, i) => ({
        text: {
            query: word,
            path: ['text', 'synonyms'],
            score: { boost: { value: POSITIONAL_BOOSTS[i] } },
        },
    }));
}

/**
 * Resolve automaticamente Product.titleId a partir do texto de um título de
 * marketplace (ex: "Kit Pastilha Freio Dianteiro Civic 2016-2021"), usando
 * Atlas Search (fuzzy + phrase) contra product_short_titles — sem exigir que
 * o usuário passe pelo ShortTitlePicker manualmente.
 *
 * Só grava quando o melhor resultado domina claramente o segundo colocado
 * (mesmo princípio de confiança do TitleCategoryHintService.suggestCategory)
 * e o produto ainda não tem titleId — nunca sobrescreve.
 *
 * Ver docs/superpowers/specs/2026-08-19-shorttitle-discovery-from-titles-design.md.
 */
@Injectable()
export class ShortTitleDiscoveryService {
    private readonly logger = new Logger(ShortTitleDiscoveryService.name);

    // Top score precisa ser > runnerUp * ratio para não auto-aplicar um match ambíguo
    // (ex: "Kit Pastilha" batendo quase igual em "Kit Pastilha de Freio" e "Kit Pastilha
    // de Embreagem"). Sem calibração em produção ainda — ajustar com dados reais.
    private static readonly CONFIDENCE_RATIO = 1.3;
    private static readonly MIN_SCORE = 1.0;

    constructor(
        @InjectModel(ProductShortTitleModel.name)
        private readonly titleModel: Model<ProductShortTitleDocument>,
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Fire-and-forget: nunca deve derrubar o save do título que a acionou.
     * Erros (índice ausente, Atlas fora do ar, etc.) são logados e engolidos.
     */
    async resolveForProduct(productId: string, titleText: string): Promise<void> {
        try {
            if (!Types.ObjectId.isValid(productId) || !titleText?.trim()) return;

            const product = await this.productModel
                .findById(productId)
                .select('titleId')
                .lean()
                .exec();
            if (!product || product.titleId) return; // nunca sobrescreve

            const match = await this.findBestMatch(titleText);
            if (!match) return;

            await this.productModel.updateOne(
                { _id: productId, titleId: { $exists: false } },
                {
                    $set: {
                        titleId: match._id,
                        titleText: match.text,
                        titleSynonyms: match.synonyms,
                    },
                },
            ).exec();

            this.logger.log(
                `Product ${productId}: titleId resolvido via discovery (shortTitle="${match.text}", score=${match.score.toFixed(2)})`,
            );

            try {
                this.eventEmitter.emit(
                    PRODUCT_SECTION_EVENTS.TITLE_ID_RESOLVED,
                    new ProductTitleIdResolvedEvent(productId, match._id.toHexString()),
                );
            } catch { }
        } catch (err) {
            this.logger.error(
                `resolveForProduct falhou (productId=${productId}): ${(err as Error).message}`,
            );
        }
    }

    private async findBestMatch(titleText: string): Promise<ShortTitleSearchHit | null> {
        const hits = await this.titleModel.aggregate<ShortTitleSearchHit>([
            {
                $search: {
                    index: 'short_title_search',
                    compound: {
                        should: [
                            {
                                phrase: {
                                    query: titleText,
                                    path: ['text', 'synonyms'],
                                    slop: 3,
                                },
                            },
                            {
                                text: {
                                    query: titleText,
                                    path: ['text', 'synonyms'],
                                    fuzzy: { maxEdits: 1 },
                                },
                            },
                            ...buildPositionalBoostClauses(titleText),
                        ],
                    },
                },
            },
            { $limit: 2 },
            {
                $project: {
                    text: 1,
                    synonyms: 1,
                    score: { $meta: 'searchScore' },
                },
            },
        ]).exec();

        const [top, runnerUp] = hits;
        if (!top || top.score < ShortTitleDiscoveryService.MIN_SCORE) return null;
        if (runnerUp && top.score < runnerUp.score * ShortTitleDiscoveryService.CONFIDENCE_RATIO) return null;

        return top;
    }
}
