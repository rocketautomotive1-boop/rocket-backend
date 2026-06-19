import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
    QuestionIngestRequestedCommand,
    WEBHOOK_DOMAIN_COMMANDS,
} from '../webhook/events/webhook.events';
import { QuestionRepository } from './question.repository';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MercadoLivreAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { AiService } from '../ai/ai.service';
import { ProductCompatibilityService } from '../product/services/product-compatibility.service';
import { QuestionIngestService } from './ingest/question-ingest.service';

@Injectable()
export class QuestionsService {
    private readonly logger = new Logger(QuestionsService.name);

    constructor(
        private readonly questionRepository: QuestionRepository,
        private marketplaceRegistry: MarketplaceRegistryService,
        private marketplaceAuth: MarketplaceAuthService,
        private mercadoLivreAdapter: MercadoLivreAdapter,
        private aiService: AiService,
        private productCompatibilityService: ProductCompatibilityService,
        private questionIngest: QuestionIngestService,
    ) { }

    @OnEvent(WEBHOOK_DOMAIN_COMMANDS.QUESTION_INGEST_REQUESTED, { async: true })
    async handleQuestionIngestRequested(event: QuestionIngestRequestedCommand): Promise<void> {
        this.logger.log(`[Webhook] Question ingest requested ${event.marketplace}/${event.externalQuestionId}`);
        await this.questionIngest.ingest(event.externalQuestionId, 'webhook');
    }

    @OnEvent('question.sync_requested', { async: true })
    async handleLegacyQuestionWebhook(event: { marketplace: string; payload: any }): Promise<void> {
        const resourceId = event.payload?.resource?.split('/').pop();
        if (resourceId && event.marketplace === 'mercadolivre') {
            await this.questionIngest.ingest(resourceId, 'webhook');
        }
    }

    async findAll(query: {
        status?: 'UNANSWERED' | 'ANSWERED';
        marketplaceId?: string;
        search?: string;
        sort?: string;
        order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
    }) {
        try {
            const where: any = {};
            if (query.status) where.status = query.status;
            if (query.marketplaceId) where.marketplaceId = query.marketplaceId;

            if (query.search) {
                const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                where.$or = [
                    { question: { $regex: escapedSearch, $options: 'i' } },
                    { answer: { $regex: escapedSearch, $options: 'i' } },
                    { buyerName: { $regex: escapedSearch, $options: 'i' } },
                ];
            }

            const allowedSortFields = ['dateCreated', 'dateAnswered', 'status', 'responseTimeMinutes'];
            const sortField = allowedSortFields.includes(query.sort) ? query.sort : 'dateCreated';
            const sortDirection = query.order === 'asc' ? 1 : -1;

            const total = await this.questionRepository.count(where);
            const items = await this.questionRepository.findAll(where, {
                limit: query.limit || 50,
                offset: query.offset || 0,
                sort: { [sortField]: sortDirection }
            });

            // Map items to include the correct title from productTitles (embedded in product)
            const mappedItems = items.map(item => {
                const product: any = item.product;
                if (product && product.productTitles && item.itemId) {
                    // Find the title that matches this itemId (externalId in productTitles)
                    const matchingTitle = product.productTitles.find(
                        (pt: any) => pt.externalId === item.itemId
                    );

                    // We return a plain object with modified product name
                    const itemObj = item.toObject ? item.toObject() : item;
                    return {
                        ...itemObj,
                        product: {
                            ...product.toObject ? product.toObject() : product,
                            name: matchingTitle?.title || product.name || null
                        }
                    };
                }
                return item;
            });

            return { items: mappedItems, total };
        } catch (error) {
            this.logger.error(`Error in findAll: ${error.message}`, error.stack);
            throw error;
        }
    }

    async getStats() {
        const unansweredCount = await this.questionRepository.count({ status: 'UNANSWERED' });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const answeredToday = await this.questionRepository.count({
            status: 'ANSWERED',
            dateAnswered: { $gte: todayStart },
        });

        const avgResult = await this.questionRepository.aggregate([
            {
                $match: {
                    status: 'ANSWERED',
                    dateAnswered: { $gte: todayStart },
                    responseTimeMinutes: { $exists: true, $ne: null },
                },
            },
            {
                $group: {
                    _id: null,
                    avgResponseTime: { $avg: '$responseTimeMinutes' },
                },
            },
        ]);

        return {
            unansweredCount,
            answeredToday,
            avgResponseTimeMinutes: avgResult[0]?.avgResponseTime
                ? Math.round(avgResult[0].avgResponseTime)
                : null,
        };
    }

    async getAiSuggestion(questionId: string) {
        const question = await this.questionRepository.findByIdWithProduct(questionId);
        if (!question) throw new NotFoundException('Question not found');

        if (!question.product) {
            throw new Error('Produto não vinculado a esta pergunta. Não é possível gerar sugestão com IA.');
        }

        const product = question.product as any;
        let compatibilities: any[] = [];
        try {
            compatibilities = await this.productCompatibilityService.getCompatibilitiesByProduct(String(product._id));
        } catch (e) {
            this.logger.warn(`Could not fetch compatibilities for AI suggestion: ${e.message}`);
        }

        const suggestion = await this.aiService.suggestQuestionAnswer(
            question.question,
            product,
            compatibilities,
        );

        question.aiSuggestedAnswer = suggestion;
        await question.save();

        return { suggestion };
    }

    async answerQuestion(id: string, text: string, aiSuggestionUsed?: boolean) {
        const question = await this.questionRepository.findById(id);
        if (!question) throw new NotFoundException('Question not found');

        const marketplace = await this.marketplaceRegistry.findOne(question.marketplaceId as any);
        const activeToken = await this.marketplaceAuth.ensureValidToken(marketplace._id);
        const token = activeToken?.accessToken;

        if (!token) throw new Error(`No active token found for marketplace ${marketplace.name}`);

        // Adapter Logic
        if (marketplace.name === 'Mercado Livre') {
            await this.mercadoLivreAdapter.answerQuestionWithToken(token, question.externalId, text);
        } else {
            throw new Error(`Answer logic not implemented for ${marketplace.name}`);
        }

        // Update Local DB
        question.answer = text;
        question.status = 'ANSWERED';
        question.dateAnswered = new Date();
        question.responseTimeMinutes = Math.round(
            (Date.now() - new Date(question.dateCreated).getTime()) / 60000,
        );
        if (aiSuggestionUsed !== undefined) {
            question.aiSuggestionUsed = aiSuggestionUsed;
        }
        await question.save();

        return { success: true };
    }
}
