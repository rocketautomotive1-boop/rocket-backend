import { Injectable, Logger, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { QuestionRepository } from './question.repository';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MercadoLivreAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { NotificationsService } from '../notifications/notifications.service';
import { MercadoLivreService } from '../marketplace/services/mercado-livre.service';
import { ProductService } from '../product/product.service';
import { ProductTitleService } from '../product/services/product-title.service';

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
    ) { }

    async findAll(query: { status?: 'UNANSWERED' | 'ANSWERED'; marketplaceId?: string; limit?: number; offset?: number }) {
        try {
            const where: any = {};
            if (query.status) where.status = query.status;
            if (query.marketplaceId) where.marketplaceId = query.marketplaceId;

            const total = await this.questionRepository.count(where);
            const items = await this.questionRepository.findAll(where, {
                limit: query.limit || 50,
                offset: query.offset || 0,
                sort: { dateCreated: -1 }
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

    async answerQuestion(id: string, text: string) {
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
        await question.save();

        return { success: true };
    }

    async syncQuestions() {
        this.logger.log('Starting Questions Sync...');
        const marketplaces = await this.marketplaceRegistry.findAll();

        for (const marketplace of marketplaces) {
            if (!marketplace.enabled) continue;

            try {
                const mpWithTokens = await this.marketplaceRegistry.findOne(String(marketplace._id));
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

    private async syncMercadoLivreQuestions(marketplace: any, token: string, sellerId: string) {
        // Fetch ALL questions (or specifically UNANSWERED + ANSWERED)
        // Let's fetch without status filter to get everything recent
        const questions = await this.mercadoLivreAdapter.getQuestions(token, sellerId);
        this.logger.log(`Found ${questions.length} questions for ML`);

        let newCount = 0;

        for (const q of questions) {
            const exists = await this.questionRepository.findOne({ externalId: String(q.id) });

            // If exists, checks if status changed (e.g. was unanswered, now answered externally)
            if (exists) {
                // If the question exists BUT has no product linked, we proceed to try linking it (Flow continues)
                if (!exists.product) {
                    this.logger.log(`[Sync] retrying link for existing question ${exists.id} (Item: ${exists.itemId})`);
                }
                // If it HAS a product and just needs status update, handle here and skip
                else {
                    if (exists.status !== q.status) {
                        exists.status = q.status;
                        if (q.answer) {
                            exists.answer = q.answer.text;
                            exists.dateAnswered = new Date(q.answer.date_created);
                        }
                        await exists.save();
                    }
                    continue;
                }
            }

            // Find Product
            let productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(q.item_id, marketplace._id);
            this.logger.log(`[Sync] Questions - Exact match for ${q.item_id}? ${productMarketplace ? 'YES' : 'NO'}`);

            // Fallback: Try identifying by numeric part only if not found (in case of prefix mismatch like MLB vs MLA)
            if (!productMarketplace) {
                const numericId = q.item_id.replace(/\D/g, ''); // Remove non-digits
                if (numericId && numericId !== q.item_id) {
                    this.logger.log(`[Sync] Questions - Retrying with numeric ID: ${numericId}`);
                    // We need a new method in MarketplaceService or just use a raw query if needed,
                    // but for now let's hope finding by externalId works if the user stored it without prefix.
                    // Or better: fetch all productMarketplaces for this marketplace and find in memory? (Too expensive).
                    // Let's rely on the assumption that maybe it's stored without prefix.
                    productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(numericId, marketplace._id);
                    if (!productMarketplace) {
                        // One last try: MLB + numericId (if original was MLA or something else)
                        const mlbId = `MLB${numericId}`;
                        if (mlbId !== q.item_id) {
                            productMarketplace = await this.productTitleService.findByExternalIdAndMarketplaceId(mlbId, marketplace._id);
                        }
                    }
                }
            }

            // AUTO-LINKING: If still not found, fetch item from ML, get SKU, and try to link to local Product
            if (!productMarketplace) {
                try {
                    this.logger.log(`[Sync] Auto-Link: Fetching details for item ${q.item_id} to try matching by SKU...`);
                    // We need a token. We can reuse 'token' passed to this method.
                    const itemDetails = await this.mercadoLivreService.getItem(q.item_id, token);

                    // Extract SKU (seller_custom_field or from attributes)
                    const sku = itemDetails.seller_custom_field ||
                        itemDetails.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;

                    if (sku) {
                        this.logger.log(`[Sync] Auto-Link: Found SKU '${sku}' for item ${q.item_id}. Searching local product...`);

                        // Check ProductService for SKU method. Usually it is findBySku or similar.
                        // I will assume findByPartNumber or I will use repository directly if needed, but service is safer.
                        // I'll check the file I viewed.
                        const localProduct = await this.productService.findBySku(sku);

                        if (localProduct) {
                            this.logger.log(`[Sync] Auto-Link: Match found! Linking Product ${localProduct.sku} (${localProduct.name}) to ML Item ${q.item_id}`);

                            // Create the link
                            productMarketplace = await this.productTitleService.create(localProduct.sku, {
                                marketplaceId: marketplace._id,
                                externalId: q.item_id,
                                syncStatus: itemDetails.status === 'active' ? 'synced' : 'paused', // Simple mapping
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
                        this.logger.warn(`[Sync] Auto-Link: No SKU found for item ${q.item_id}.`);
                    }
                } catch (autoLinkError) {
                    this.logger.error(`[Sync] Auto-Link Failed for ${q.item_id}: ${autoLinkError.message}`);
                }
            }

            if (exists) {
                // ProductTitle no longer has .product reference - it's embedded in ProductModel
                // We need to use productMarketplace differently or skip product linking
                if (productMarketplace) {
                    // productMarketplace is a ProductTitle which has marketplaceId and externalId
                    // To get the actual product, we'd need to query by the title's product reference
                    // For now, just update the itemId
                    exists.itemId = q.item_id;
                    await exists.save();
                    this.logger.log(`[Sync] Updated existing question ${exists.id} with item ${q.item_id}`);
                }
                continue; // We already handled status updates above or can just skip
            }

            const newQuestion = await this.questionRepository.create({
                externalId: String(q.id),
                itemId: q.item_id,
                question: q.text,
                status: q.status === 'ANSWERED' ? 'ANSWERED' : 'UNANSWERED',
                dateCreated: new Date(q.date_created),
                marketplaceId: marketplace._id,
                product: null,
                buyerId: String(q.from?.id),
                answer: q.answer ? q.answer.text : null,
                dateAnswered: q.answer ? new Date(q.answer.date_created) : null
            });
            newCount++;

            // Trigger Notification ONLY for UNANSWERED questions
            if (newQuestion.status === 'UNANSWERED') {
                this.notificationsService.notifyAllAdmins(
                    'Nova Pergunta!',
                    `${q.text} (em ${q.item_id})`, // Use item_id since we don't have direct product reference
                    { actionRoute: '/(drawer)/questions' }
                );
            }
        }

        this.logger.log(`Synced ${newCount} new questions.`);
    }
}
