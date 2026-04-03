import { Injectable, Logger, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { QuestionRepository } from './question.repository';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MercadoLivreAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { NotificationsService } from '../notifications/notifications.service';
import { MercadoLivreService } from '../marketplace/services/mercado-livre.service';
import { ProductService } from '../product/product.service';
import { ProductTitleService } from '../product/services/product-title.service';
import { AiService } from '../ai/ai.service';
import { ProductCompatibilityService } from '../product/services/product-compatibility.service';

@Injectable()
export class QuestionsService {
    private readonly logger = new Logger(QuestionsService.name);

    constructor(
        private readonly questionRepository: QuestionRepository,
        private marketplaceRegistry: MarketplaceRegistryService,
        private marketplaceAuth: MarketplaceAuthService,
        private mercadoLivreAdapter: MercadoLivreAdapter,
        private mercadoLivreService: MercadoLivreService,
        @Inject(forwardRef(() => ProductService))
        private productService: ProductService,
        private notificationsService: NotificationsService,
        private productTitleService: ProductTitleService,
        private aiService: AiService,
        private productCompatibilityService: ProductCompatibilityService,
        private eventEmitter: EventEmitter2,
    ) { }

    @OnEvent('question.sync_requested', { async: true })
    async handleQuestionWebhook(event: { marketplace: string; payload: any }): Promise<void> {
        this.logger.log(`[Webhook] Question sync triggered for ${event.marketplace}`);
        try {
            const resourceId = event.payload?.resource?.split('/').pop();
            if (resourceId && event.marketplace === 'mercadolivre') {
                await this.syncSingleQuestion(resourceId);
            } else {
                await this.syncQuestions();
            }
        } catch (error) {
            this.logger.error(`[Webhook] Question sync failed: ${error.message}`, error.stack);
        }
    }

    private async syncSingleQuestion(mlQuestionId: string) {
        this.logger.log(`[Webhook] Incremental sync for question ${mlQuestionId}`);

        const marketplaces = await this.marketplaceRegistry.findAll();
        const mlMarketplace = marketplaces.find(m => m.enabled && m.name === 'Mercado Livre');
        if (!mlMarketplace) return;

        let activeToken: any = await this.marketplaceAuth.getToken(mlMarketplace._id);
        if (!activeToken) return;

        if (activeToken.expiresAt && new Date(activeToken.expiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
            try {
                activeToken = await this.marketplaceAuth.ensureValidToken(mlMarketplace._id);
            } catch { return; }
        }

        const q = await this.mercadoLivreAdapter.getQuestionById(activeToken.accessToken, mlQuestionId);
        if (!q) return;

        await this.upsertQuestion(q, mlMarketplace, activeToken.accessToken);
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
        const activeToken = await this.marketplaceAuth.getToken(marketplace._id);
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

    async syncQuestions() {
        this.logger.log('Starting Questions Sync...');
        const marketplaces = await this.marketplaceRegistry.findAll();

        for (const marketplace of marketplaces) {
            if (!marketplace.enabled) continue;

            try {
                let activeToken: any = await this.marketplaceAuth.getToken(marketplace._id);

                if (!activeToken) {
                    this.logger.warn(`Skipping sync for ${marketplace.name} (No active token)`);
                    continue;
                }

                // Check for expiration
                if (activeToken.expiresAt && new Date(activeToken.expiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
                    this.logger.log(`Token for ${marketplace.name} is expired or about to expire. Refreshing...`);
                    try {
                        activeToken = await this.marketplaceAuth.ensureValidToken(marketplace._id);
                    } catch (refreshError) {
                        this.logger.error(`Failed to refresh token for ${marketplace.name}: ${refreshError.message}`);
                        continue; // Skip this marketplace if refresh fails
                    }
                }

                if (marketplace.name === 'Mercado Livre') {
                    const sellerId = activeToken.additionalData?.userId;
                    if (!sellerId) {
                        this.logger.warn(`Skipping sync for ${marketplace.name} (No sellerId found in token data)`);
                        continue;
                    }

                    try {
                        await this.syncMercadoLivreQuestions(marketplace, activeToken.accessToken, sellerId);
                    } catch (error) {
                        // If 401, try to refresh and retry once
                        if (error.response?.status === 401 || error.message?.includes('401')) {
                            this.logger.warn(`Received 401 for ${marketplace.name}. Attempting to refresh token and retry...`);
                            try {
                                activeToken = await this.marketplaceAuth.ensureValidToken(marketplace._id);
                                await this.syncMercadoLivreQuestions(marketplace, activeToken.accessToken, sellerId);
                                this.logger.log(`Retry successful for ${marketplace.name}`);
                            } catch (retryError) {
                                this.logger.error(`Retry failed regarding 401 for ${marketplace.name}: ${retryError.message}`);
                            }
                        } else {
                            throw error; // Re-throw other errors
                        }
                    }
                }

            } catch (error) {
                this.logger.error(`Error syncing questions for ${marketplace.name}: ${error.message}`);
            }
        }

        return { message: 'Sync completed' };
    }

    private async resolveProductId(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null> {
        let productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(itemId, marketplace._id);
        this.logger.log(`[Sync] Questions - Exact match for ${itemId}? ${productMarketplace ? 'YES' : 'NO'}`);

        if (!productMarketplace) {
            const numericId = itemId.replace(/\D/g, '');
            if (numericId && numericId !== itemId) {
                this.logger.log(`[Sync] Questions - Retrying with numeric ID: ${numericId}`);
                productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(numericId, marketplace._id);
                if (!productMarketplace) {
                    const mlbId = `MLB${numericId}`;
                    if (mlbId !== itemId) {
                        productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(mlbId, marketplace._id);
                    }
                }
            }
        }

        if (!productMarketplace) {
            try {
                this.logger.log(`[Sync] Auto-Link: Fetching details for item ${itemId} to try matching by SKU...`);
                const itemDetails = await this.mercadoLivreService.getItem(itemId, token);

                const sku = itemDetails.seller_custom_field ||
                    itemDetails.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;

                if (sku) {
                    this.logger.log(`[Sync] Auto-Link: Found SKU '${sku}' for item ${itemId}. Searching local product...`);
                    const localProduct = await this.productService.findByBarcode(sku);

                    if (localProduct) {
                        this.logger.log(`[Sync] Auto-Link: Match found! Linking Product ${String(localProduct._id)} (${localProduct.name}) to ML Item ${itemId}`);
                        productMarketplace = await this.productTitleService.create(String(localProduct._id), {
                            marketplaceId: marketplace._id,
                            externalId: itemId,
                            syncStatus: itemDetails.status === 'active' ? 'synced' : 'paused',
                            marketplaceData: {
                                permalink: itemDetails.permalink,
                                price: itemDetails.price,
                                title: itemDetails.title
                            }
                        });
                    } else {
                        this.logger.warn(`[Sync] Auto-Link: SKU '${sku}' not found in local products.`);
                    }
                } else {
                    this.logger.warn(`[Sync] Auto-Link: No SKU found for item ${itemId}.`);
                }
            } catch (autoLinkError) {
                this.logger.error(`[Sync] Auto-Link Failed for ${itemId}: ${autoLinkError.message}`);
            }
        }

        if (productMarketplace?.product?.id) {
            return new Types.ObjectId(productMarketplace.product.id);
        }
        return null;
    }

    private async upsertQuestion(q: any, marketplace: any, token: string): Promise<boolean> {
        const exists = await this.questionRepository.findOne({ externalId: String(q.id) });

        if (exists) {
            let changed = false;

            if (exists.status !== q.status) {
                exists.status = q.status;
                changed = true;
                if (q.answer) {
                    exists.answer = q.answer.text;
                    exists.dateAnswered = new Date(q.answer.date_created);
                }
            }

            if (!exists.product && q.item_id) {
                const productId = await this.resolveProductId(q.item_id, marketplace, token);
                if (productId) {
                    exists.product = productId;
                    exists.itemId = q.item_id;
                    changed = true;
                    this.logger.log(`[Sync] Linked product ${productId} to existing question ${exists.id}`);
                }
            }

            if (changed) await exists.save();
            return false;
        }

        const productId = await this.resolveProductId(q.item_id, marketplace, token);

        const newQuestion = await this.questionRepository.create({
            externalId: String(q.id),
            itemId: q.item_id,
            question: q.text,
            status: q.status === 'ANSWERED' ? 'ANSWERED' : 'UNANSWERED',
            dateCreated: new Date(q.date_created),
            marketplaceId: marketplace._id,
            product: productId,
            buyerId: String(q.from?.id),
            buyerName: q.from?.nickname || null,
            answer: q.answer ? q.answer.text : null,
            dateAnswered: q.answer ? new Date(q.answer.date_created) : null,
            responseTimeMinutes: q.answer
                ? Math.round((new Date(q.answer.date_created).getTime() - new Date(q.date_created).getTime()) / 60000)
                : null,
        });

        if (newQuestion.status === 'UNANSWERED') {
            this.eventEmitter.emit('notification.send', {
                category: 'question',
                title: 'Nova Pergunta!',
                body: `${q.text.substring(0, 100)} — ${q.item_id}`,
                data: {
                    type: 'question',
                    actionRoute: '/(drawer)/questions',
                    externalId: String(q.id),
                    marketplace: 'mercadolivre',
                },
                channels: ['push', 'websocket', 'persist'],
                severity: 'info',
                deduplicationKey: `question:mercadolivre:${q.id}`,
            });
        }

        return true;
    }

    private async syncMercadoLivreQuestions(marketplace: any, token: string, sellerId: string) {
        const questions = await this.mercadoLivreAdapter.getQuestions(token, sellerId);
        this.logger.log(`Found ${questions.length} questions for ML`);

        let newCount = 0;

        for (const q of questions) {
            const isNew = await this.upsertQuestion(q, marketplace, token);
            if (isNew) newCount++;
        }

        this.logger.log(`Synced ${newCount} new questions.`);
    }
}
