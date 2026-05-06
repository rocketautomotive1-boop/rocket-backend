import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { ListingModel } from '../../listing/schemas/listing.schema';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';

type MlInfraction = {
    id?: string;
    date_created?: string;
    related_item_id?: string;
    element_id?: string;
    element_type?: string;
    filter_subgroup?: string;
    reason?: string;
    remedy?: string;
    suggested?: any;
};

@Injectable()
export class ItemModerationService {
    private readonly logger = new Logger(ItemModerationService.name);
    private readonly baseUrl = 'https://api.mercadolibre.com';

    constructor(
        @InjectModel(ListingModel.name)
        private readonly listingModel: Model<ListingModel>,
        private readonly authAdapter: MercadoLivreAuthAdapter,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Queries ML moderations (infractions) to identify items closed due to
     * wrong category and reconciles affected listings in the database.
     */
    async checkWrongCategoryItems(): Promise<void> {
        let mlUser: any;
        let token: string;

        try {
            mlUser = await this.authAdapter.me('Mercado Livre');
            token = await this.authAdapter.getValidToken('Mercado Livre');
        } catch (err) {
            this.logger.warn(`Skipping moderation check - ML auth unavailable: ${(err as Error).message}`);
            return;
        }

        const mlMarketplace = await this.marketplaceRegistry.findByTag('mercadolivre');
        if (!mlMarketplace) {
            this.logger.warn('Skipping moderation check - Mercado Livre marketplace not found in registry');
            return;
        }

        const infractions = await this.fetchInfractions(String(mlUser.id), token);
        let categoryInfractions = infractions.filter((inf) => this.isWrongCategoryInfraction(inf));

        // Fallback for tenants/accounts where infractions endpoint is unavailable or lagged.
        if (!categoryInfractions.length) {
            const forbiddenIds = await this.fetchClosedForbiddenItems(String(mlUser.id), token);
            if (forbiddenIds.length) {
                categoryInfractions = forbiddenIds.map((id) => ({
                    related_item_id: id,
                    element_id: id,
                    element_type: 'ITM',
                    filter_subgroup: 'DOMAIN',
                    reason: 'Estava em uma categoria incorreta.',
                    remedy: '',
                }));
            }
        }

        const latestByItemId = new Map<string, MlInfraction>();
        for (const inf of categoryInfractions) {
            const itemId = String(inf.related_item_id || inf.element_id || '').trim();
            if (!itemId) continue;
            const prev = latestByItemId.get(itemId);
            if (!prev) {
                latestByItemId.set(itemId, inf);
                continue;
            }
            const prevDate = new Date(prev.date_created || 0).getTime();
            const nextDate = new Date(inf.date_created || 0).getTime();
            if (nextDate >= prevDate) {
                latestByItemId.set(itemId, inf);
            }
        }

        const closedItemIds = Array.from(latestByItemId.keys());

        if (!closedItemIds.length) {
            this.logger.debug('No items closed for wrong category based on infractions');
            return;
        }

        this.logger.log(`Found ${closedItemIds.length} ML item(s) with wrong-category moderation`);

        const affectedListings = await this.listingModel.find({
            marketplaceId: mlMarketplace._id,
            externalId: { $in: closedItemIds },
            status: { $ne: 'removed' },
        });

        if (!affectedListings.length) {
            this.logger.debug('No new listings to flag - all already processed');
            return;
        }

        this.logger.log(`Processing ${affectedListings.length} affected listing(s)`);

        for (const listing of affectedListings) {
            const itemId = String(listing.externalId || '').trim();
            const infraction = latestByItemId.get(itemId);
            await this.handleWrongCategoryListing(listing, infraction || null, token);
        }
    }

    /**
     * Queries ML moderations (infractions) to identify items with missing
     * compatibilities and marks listings with MISSING_COMPATIBILITIES.
     */
    async checkMissingCompatibilityItems(): Promise<void> {
        let mlUser: any;
        let token: string;

        try {
            mlUser = await this.authAdapter.me('Mercado Livre');
            token = await this.authAdapter.getValidToken('Mercado Livre');
        } catch (err) {
            this.logger.warn(`Skipping compatibility moderation check - ML auth unavailable: ${(err as Error).message}`);
            return;
        }

        const mlMarketplace = await this.marketplaceRegistry.findByTag('mercadolivre');
        if (!mlMarketplace) {
            this.logger.warn('Skipping compatibility moderation check - Mercado Livre marketplace not found in registry');
            return;
        }

        const infractions = await this.fetchInfractions(String(mlUser.id), token);
        const compatibilityInfractions = infractions.filter((inf) => this.isCompatibilityInfraction(inf));

        const latestByItemId = new Map<string, MlInfraction>();
        for (const inf of compatibilityInfractions) {
            const itemId = String(inf.related_item_id || inf.element_id || '').trim();
            if (!itemId) continue;
            const prev = latestByItemId.get(itemId);
            if (!prev) {
                latestByItemId.set(itemId, inf);
                continue;
            }
            const prevDate = new Date(prev.date_created || 0).getTime();
            const nextDate = new Date(inf.date_created || 0).getTime();
            if (nextDate >= prevDate) {
                latestByItemId.set(itemId, inf);
            }
        }

        const itemIds = Array.from(latestByItemId.keys());
        if (!itemIds.length) {
            this.logger.debug('No items with compatibility moderation issues based on infractions');
            return;
        }

        this.logger.log(`Found ${itemIds.length} ML item(s) with compatibility moderation`);

        const listings = await this.listingModel.find({
            marketplaceId: mlMarketplace._id,
            externalId: { $in: itemIds },
            status: { $ne: 'removed' },
        });

        if (!listings.length) {
            this.logger.debug('No local listings mapped to compatibility moderation items');
            return;
        }

        for (const listing of listings) {
            // If listing is already terminal recreate, do not override with compatibility issue.
            const classifier = String(listing.marketplaceData?.syncIssue?.classifier || '').toUpperCase();
            if (classifier === 'TERMINAL_RECREATE') continue;

            const itemId = String(listing.externalId || '').trim();
            const infraction = latestByItemId.get(itemId) || null;
            await this.handleMissingCompatibilityListing(listing, infraction);
        }
    }

    private async handleWrongCategoryListing(listing: any, infraction: MlInfraction | null, token: string): Promise<void> {
        const previousExternalId = listing.externalId;
        const reason = String(infraction?.reason || 'Estava em uma categoria incorreta.');
        const remedy = String(infraction?.remedy || '');
        const categorySuggestions = Array.isArray(infraction?.suggested?.categories)
            ? infraction?.suggested?.categories
            : [];
        const closeResult = await this.closeItemOnMl(previousExternalId, token);
        const blockedCategoryId =
            listing.marketplaceData?.wrongCategoryOriginalCategoryId ||
            listing.marketplaceData?.syncMetadata?.itemCategoryId ||
            await this.fetchItemCategoryId(previousExternalId, token);
        const moderationId = infraction?.id ? String(infraction.id) : null;
        const moderationAt = infraction?.date_created ? new Date(infraction.date_created) : new Date();

        if (
            listing.marketplaceData?.closedReason === 'wrong_category' &&
            listing.marketplaceData?.closedExternalId === previousExternalId &&
            (!moderationId || String(listing.marketplaceData?.moderationInfractionId || '') === moderationId)
        ) {
            this.logger.debug(
                `Listing ${listing._id} already flagged for wrong category on ${previousExternalId}. Skipping.`,
            );
            return;
        }

        try {
            listing.status = 'error';
            listing.errorMessage = reason || 'Finalizado pelo Mercado Livre - Categoria incorreta';
            listing.externalId = null;
            listing.synchronized = false;
            listing.publishingAt = null;
            listing.lastSyncAt = new Date();
            listing.marketplaceData = {
                ...listing.marketplaceData,
                closedReason: 'wrong_category',
                closedExternalId: previousExternalId,
                closedAt: moderationAt,
                moderationInfractionId: moderationId,
                moderationFilterSubgroup: String(infraction?.filter_subgroup || 'DOMAIN'),
                moderationReason: reason,
                moderationRemedy: remedy,
                moderationSuggestedCategories: categorySuggestions,
                moderationAutoClose: closeResult,
                wrongCategoryOriginalCategoryId: blockedCategoryId || null,
                recreateRequired: true,
                syncIssue: {
                    blocked: true,
                    issueKey: 'terminal_recreate_required',
                    classifier: 'TERMINAL_RECREATE',
                    retryable: false,
                    requiredResolutionSignals: ['catalog_change', 'category_change', 'user_publish'],
                    reason: 'terminal_recreate_required',
                    blockedAt: moderationAt,
                    lastErrorMessage: reason || 'Finalizado pelo Mercado Livre - Categoria incorreta',
                    lastAction: 'UPDATE',
                },
            };

            await listing.save();

            this.logger.warn(
                `Listing ${listing._id} flagged: wrong category (was ${previousExternalId})`,
            );

            this.eventEmitter.emit('notification.send', {
                category: 'moderation',
                title: 'Anuncio finalizado - Categoria incorreta',
                body: remedy
                    ? `O Mercado Livre finalizou o anuncio ${previousExternalId}. ${reason} ${remedy}`
                    : `O Mercado Livre finalizou o anuncio ${previousExternalId} por estar em uma categoria incorreta. Corrija a categoria e republique.`,
                data: {
                    type: 'moderation',
                    marketplace: 'mercadolivre',
                    productId: listing.productId?.toString(),
                    listingId: listing._id?.toString(),
                    previousExternalId,
                    actionRoute: '/(drawer)/products/edit',
                },
                channels: ['push', 'websocket', 'persist'],
                severity: 'warning',
                deduplicationKey: `moderation:wrong_category:${previousExternalId}`,
            });
        } catch (err) {
            this.logger.error(
                `Failed to process listing ${listing._id}: ${(err as Error).message}`,
            );
        }
    }

    private async handleMissingCompatibilityListing(listing: any, infraction: MlInfraction | null): Promise<void> {
        const reason = String(infraction?.reason || 'Nao indica os veiculos compativeis.');
        const remedy = String(infraction?.remedy || '');
        const moderationId = infraction?.id ? String(infraction.id) : null;
        const moderationAt = infraction?.date_created ? new Date(infraction.date_created) : new Date();

        if (
            String(listing.marketplaceData?.syncIssue?.classifier || '').toUpperCase() === 'MISSING_COMPATIBILITIES' &&
            (!moderationId || String(listing.marketplaceData?.compatibilityModerationInfractionId || '') === moderationId)
        ) {
            return;
        }

        listing.status = 'error';
        listing.synchronized = false;
        listing.errorMessage = reason || 'Mercado Livre apontou compatibilidades incompletas para este anuncio.';
        listing.lastSyncAt = new Date();
        listing.marketplaceData = {
            ...listing.marketplaceData,
            closedReason: null,
            closedAt: null,
            closedExternalId: null,
            wrongCategoryOriginalCategoryId: null,
            moderationInfractionId: null,
            moderationFilterSubgroup: null,
            moderationReason: null,
            moderationRemedy: null,
            moderationSuggestedCategories: [],
            moderationAutoClose: null,
            recreateRequired: false,
            recreateClassifier: null,
            compatibilityModerationInfractionId: moderationId,
            compatibilityModerationReason: reason,
            compatibilityModerationRemedy: remedy,
            compatibilityModerationAt: moderationAt,
            syncIssue: {
                blocked: true,
                issueKey: 'missing_compatibilities',
                classifier: 'MISSING_COMPATIBILITIES',
                retryable: true,
                requiredResolutionSignals: ['compatibility_sync', 'catalog_change', 'state_recheck', 'user_publish'],
                retryAfterSeconds: 1800,
                reason: 'missing_compatibilities',
                blockedAt: moderationAt,
                lastErrorMessage: reason,
                lastAction: 'UPDATE',
            },
        };

        await listing.save();
    }

    private async fetchItemCategoryId(itemId: string | null | undefined, token: string): Promise<string | null> {
        if (!itemId) return null;
        try {
            const response = await axios.get(`${this.baseUrl}/items/${itemId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return response.data?.category_id ? String(response.data.category_id) : null;
        } catch {
            return null;
        }
    }

    private async closeItemOnMl(itemId: string | null | undefined, token: string): Promise<{
        attempted: boolean;
        closed: boolean;
        alreadyClosed: boolean;
        statusBefore?: string | null;
        error?: string | null;
        at: string;
    }> {
        const nowIso = new Date().toISOString();
        if (!itemId) {
            return { attempted: false, closed: false, alreadyClosed: false, error: 'missing_item_id', at: nowIso };
        }

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        try {
            const itemRes = await axios.get(`${this.baseUrl}/items/${itemId}`, { headers });
            const statusBefore = itemRes?.data?.status ? String(itemRes.data.status).toLowerCase() : null;

            if (statusBefore === 'closed') {
                return {
                    attempted: true,
                    closed: false,
                    alreadyClosed: true,
                    statusBefore,
                    at: nowIso,
                };
            }

            await axios.put(`${this.baseUrl}/items/${itemId}`, { status: 'closed' }, { headers });
            this.logger.warn(`[Moderations] Item ${itemId} auto-closed on ML due wrong_category moderation`);
            return {
                attempted: true,
                closed: true,
                alreadyClosed: false,
                statusBefore,
                at: nowIso,
            };
        } catch (err: any) {
            const status = err?.response?.status || 'N/A';
            const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || 'unknown_error');
            this.logger.warn(`[Moderations] Failed to auto-close item ${itemId}: [${status}] ${msg}`);
            return {
                attempted: true,
                closed: false,
                alreadyClosed: false,
                error: `[${status}] ${msg}`,
                at: nowIso,
            };
        }
    }

    private async fetchInfractions(userId: string, token: string): Promise<MlInfraction[]> {
        const headers = { Authorization: `Bearer ${token}` };
        const limit = 20;
        const maxPages = 10;
        const result: MlInfraction[] = [];

        const endpointCandidates = [
            `${this.baseUrl}/moderations/infractions/${userId}`,
            `${this.baseUrl}/marketplace/moderations/infractions/${userId}`,
        ];

        for (const endpoint of endpointCandidates) {
            try {
                let offset = 0;
                for (let page = 0; page < maxPages; page++) {
                    const response = await axios.get(endpoint, {
                        params: {
                            element_type: 'ITM',
                            sort: 'date_created_desc',
                            limit,
                            offset,
                        },
                        headers,
                    });

                    const infractions: MlInfraction[] = Array.isArray(response.data?.infractions)
                        ? response.data.infractions
                        : [];

                    if (!infractions.length) break;
                    result.push(...infractions);

                    const total = Number(response.data?.paging?.total || 0);
                    offset += limit;
                    if (offset >= total) break;
                }

                if (result.length > 0) {
                    this.logger.debug(`[Moderations] Loaded ${result.length} infractions from ${endpoint}`);
                }
                return result;
            } catch (err: any) {
                this.logger.warn(
                    `[Moderations] Failed endpoint ${endpoint}: ${err?.response?.status || 'N/A'} ${err?.message}`,
                );
            }
        }

        return result;
    }

    private async fetchClosedForbiddenItems(userId: string, token: string): Promise<string[]> {
        const candidates = ['forbidden', 'wrong_category'];
        const all = new Set<string>();

        for (const subStatus of candidates) {
            try {
                const response = await axios.get(`${this.baseUrl}/users/${userId}/items/search`, {
                    params: {
                        status: 'closed',
                        sub_status: subStatus,
                    },
                    headers: { Authorization: `Bearer ${token}` },
                });

                const ids = Array.isArray(response.data?.results) ? response.data.results : [];
                for (const id of ids) {
                    if (id) all.add(String(id));
                }
            } catch (err: any) {
                this.logger.warn(
                    `[Moderations] Fallback items/search failed (sub_status=${subStatus}): ` +
                    `${err?.response?.status || 'N/A'} ${err?.message}`,
                );
            }
        }

        return Array.from(all);
    }

    private isWrongCategoryInfraction(infraction: MlInfraction): boolean {
        const subgroup = String(infraction.filter_subgroup || '').toUpperCase();
        const reason = String(infraction.reason || '').toLowerCase();
        const remedy = String(infraction.remedy || '').toLowerCase();

        if (subgroup === 'DOMAIN') return true;

        if (reason.includes('categoria incorreta')) return true;
        if (reason.includes('bad_categorization')) return true;
        if (reason.includes('relevance_loss')) return true;

        if (remedy.includes('categorize o produto corretamente')) return true;

        return false;
    }

    private isCompatibilityInfraction(infraction: MlInfraction): boolean {
        const subgroup = String(infraction.filter_subgroup || '').toUpperCase();
        const reason = String(infraction.reason || '').toLowerCase();
        const remedy = String(infraction.remedy || '').toLowerCase();

        if (subgroup === 'COMPATS') return true;

        if (reason.includes('nao indica os veiculos compativeis')) return true;
        if (reason.includes('não indica os veículos compatíveis')) return true;
        if (remedy.includes('modulo de compatibilidade')) return true;

        return false;
    }
}
