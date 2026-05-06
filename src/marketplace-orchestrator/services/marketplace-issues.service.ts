import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { CategoryDocument, CategoryModel } from '../../product/schemas/category.schema';
import { OrchestratorPublisherService } from '../orchestrator-publisher.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';

@Injectable()
export class MarketplaceIssuesService {
    private readonly logger = new Logger(MarketplaceIssuesService.name);
    private readonly postPublicationClassifiers = new Set<string>([
        'TERMINAL_RECREATE',
        'MISSING_COMPATIBILITIES',
    ]);

    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
        @InjectModel(CategoryModel.name) private readonly categoryModel: Model<CategoryDocument>,
        private readonly orchestratorPublisher: OrchestratorPublisherService,
        private readonly productService: ProductService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
    ) {}

    async listIssues(params: {
        marketplaceTag?: string;
        status?: 'blocked' | 'all';
        classifier?: string;
        productId?: string;
        limit?: number;
        offset?: number;
    }) {
        const limit = Math.min(100, Math.max(1, params.limit ?? 20));
        const offset = Math.max(0, params.offset ?? 0);

        const query: any = {};
        if (params.status !== 'all') {
            query['marketplaceData.syncIssue.blocked'] = true;
        }
        if (params.classifier) {
            query['marketplaceData.syncIssue.classifier'] = params.classifier;
        } else {
            query['marketplaceData.syncIssue.classifier'] = {
                $in: Array.from(this.postPublicationClassifiers),
            };
        }
        if (params.productId) {
            if (!Types.ObjectId.isValid(params.productId)) {
                return { items: [], total: 0, paging: { limit, offset } };
            }
            query.productId = new Types.ObjectId(params.productId);
        }

        if (params.marketplaceTag) {
            const mp = await this.marketplaceRegistry.findByTag(params.marketplaceTag);
            if (!mp) {
                return { items: [], total: 0, paging: { limit, offset } };
            }
            query.marketplaceId = new Types.ObjectId(String(mp._id));
        }

        const [items, total] = await Promise.all([
            this.listingModel
                .find(query)
                .sort({ updatedAt: -1 })
                .skip(offset)
                .limit(limit)
                .select('_id productId marketplaceId externalId title status errorMessage marketplaceData lastSyncAt updatedAt')
                .lean()
                .exec(),
            this.listingModel.countDocuments(query).exec(),
        ]);
        const suggestedCategoryMap = await this.buildSuggestedInternalCategoryMap(items as any[]);

        return {
            items: items.map((l: any) => ({
                ...this.buildIssueView(l, suggestedCategoryMap),
            })),
            total,
            paging: { limit, offset },
        };
    }

    async getIssueByListing(listingId: string) {
        const listing = await this.listingModel
            .findById(listingId)
            .select('_id productId marketplaceId externalId title status errorMessage marketplaceData lastSyncAt updatedAt')
            .lean()
            .exec();

        if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);

        const fresh = await this.listingModel
            .findById(listingId)
            .select('_id productId marketplaceId externalId title status errorMessage marketplaceData lastSyncAt updatedAt')
            .lean()
            .exec();
        if (!fresh) throw new NotFoundException(`Listing ${listingId} not found`);

        const suggestedCategoryMap = await this.buildSuggestedInternalCategoryMap([fresh as any]);
        const issueView = this.buildIssueView(fresh as any, suggestedCategoryMap);

        return {
            ...issueView,
            marketplaceData: fresh.marketplaceData || {},
        };
    }

    async resolveSignal(listingId: string, resolutionSignal: string, requesterId?: string) {
        const listing = await this.listingModel.findById(listingId).lean().exec();
        if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);

        // If compatibility sync is requested, trigger compatibility sync first.
        if (resolutionSignal === 'compatibility_sync') {
            try {
                await this.productService.syncCompatibilitiesWithMarketplace(
                    String(listing.productId),
                    String(listing.marketplaceId),
                );
            } catch (err: any) {
                this.logger.warn(`[Issues] compatibility_sync failed for listing ${listingId}: ${err?.message}`);
            }
        }

        await this.orchestratorPublisher.requestSync({
            productId: String(listing.productId),
            requesterId,
            force: false,
            reason: 'manual_issue_resolution',
            resolutionSignal,
            targetMarketplaceIds: [String(listing.marketplaceId)],
        });

        return {
            message: 'Resolution signal accepted',
            listingId,
            resolutionSignal,
            queued: true,
        };
    }

    async retryIssue(listingId: string, requesterId?: string) {
        return this.resolveSignal(listingId, 'state_recheck', requesterId);
    }

    async recreateIssue(listingId: string, requesterId?: string) {
        const listing = await this.listingModel.findById(listingId).exec();
        if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);

        const previousExternalId = listing.externalId || listing.marketplaceData?.closedExternalId || null;
        listing.externalId = null;
        listing.status = 'error';
        listing.synchronized = false;
        listing.publishingAt = null;
        listing.errorMessage = listing.errorMessage || 'Recreate requested manually';
        listing.marketplaceData = {
            ...listing.marketplaceData,
            recreateRequired: true,
            closedExternalId: previousExternalId,
            syncIssue: {
                blocked: true,
                issueKey: 'terminal_recreate_required',
                classifier: 'TERMINAL_RECREATE',
                retryable: false,
                requiredResolutionSignals: ['catalog_change', 'category_change', 'user_publish'],
                reason: 'manual_recreate',
                blockedAt: new Date(),
                lastErrorMessage: listing.errorMessage,
                lastAction: 'UPDATE',
            },
        };
        await listing.save();

        await this.orchestratorPublisher.requestSync({
            productId: String(listing.productId),
            requesterId,
            force: true,
            reason: 'manual_recreate',
            resolutionSignal: 'user_publish',
            targetMarketplaceIds: [String(listing.marketplaceId)],
        });

        return {
            message: 'Listing set for recreation and queued',
            listingId,
            previousExternalId,
            queued: true,
        };
    }

    private buildIssueView(listing: any, suggestedCategoryMap: Map<string, any>) {
        const classifier = String(listing.marketplaceData?.syncIssue?.classifier || '').toUpperCase();
        const closedReason = String(listing.marketplaceData?.closedReason || '').toLowerCase();
        const recreateRequiredRaw = listing.marketplaceData?.recreateRequired === true;
        const recreateRequiredEffective =
            recreateRequiredRaw &&
            (classifier === 'TERMINAL_RECREATE' || (!classifier && closedReason === 'wrong_category'));

        const isCompatibilityIssue = classifier === 'MISSING_COMPATIBILITIES';

        const moderation = isCompatibilityIssue
            ? {
                infractionId: listing.marketplaceData?.compatibilityModerationInfractionId || null,
                filterSubgroup: listing.marketplaceData?.compatibilityModerationInfractionId ? 'COMPATS' : null,
                reason: listing.marketplaceData?.compatibilityModerationReason || null,
                remedy: listing.marketplaceData?.compatibilityModerationRemedy || null,
                suggestedCategories: [],
                suggestedInternalCategories: [],
                blockedCategoryId: null,
                at: listing.marketplaceData?.compatibilityModerationAt || null,
            }
            : {
                infractionId: listing.marketplaceData?.moderationInfractionId || null,
                filterSubgroup: listing.marketplaceData?.moderationFilterSubgroup || null,
                reason: listing.marketplaceData?.moderationReason || null,
                remedy: listing.marketplaceData?.moderationRemedy || null,
                suggestedCategories: listing.marketplaceData?.moderationSuggestedCategories || [],
                suggestedInternalCategories: (listing.marketplaceData?.moderationSuggestedCategories || [])
                    .map((s: any) => suggestedCategoryMap.get(`${String(listing.marketplaceId)}:${String(s?.id || '')}`))
                    .filter(Boolean),
                blockedCategoryId:
                    listing.marketplaceData?.wrongCategoryOriginalCategoryId ||
                    listing.marketplaceData?.syncMetadata?.itemCategoryId ||
                    null,
                at: listing.marketplaceData?.closedAt || null,
            };

        return {
            listingId: String(listing._id),
            productId: listing.productId ? String(listing.productId) : null,
            marketplaceId: listing.marketplaceId ? String(listing.marketplaceId) : null,
            externalId: listing.externalId || null,
            title: listing.title,
            status: listing.status,
            errorMessage: listing.errorMessage,
            syncIssue: listing.marketplaceData?.syncIssue || null,
            syncMetadata: listing.marketplaceData?.syncMetadata || null,
            validationSummary: listing.marketplaceData?.syncMetadata?.validationSummary || null,
            moderation,
            closedReason,
            recreateRequired: recreateRequiredEffective,
            lastSyncAt: listing.lastSyncAt || null,
            updatedAt: listing.updatedAt || null,
        };
    }

    private async buildSuggestedInternalCategoryMap(listings: any[]): Promise<Map<string, any>> {
        const byMarketplace = new Map<string, Set<string>>();

        for (const l of listings) {
            const mpId = String(l?.marketplaceId || '').trim();
            if (!mpId) continue;
            const suggestions = Array.isArray(l?.marketplaceData?.moderationSuggestedCategories)
                ? l.marketplaceData.moderationSuggestedCategories
                : [];
            for (const s of suggestions) {
                const extId = String(s?.id || '').trim();
                if (!extId) continue;
                if (!byMarketplace.has(mpId)) byMarketplace.set(mpId, new Set<string>());
                byMarketplace.get(mpId)!.add(extId);
            }
        }

        const mapped = new Map<string, any>();

        for (const [mpId, extIdsSet] of byMarketplace.entries()) {
            const extIds = Array.from(extIdsSet);
            if (!extIds.length || !Types.ObjectId.isValid(mpId)) continue;

            const categories = await this.categoryModel
                .find({
                    marketplaceMappings: {
                        $elemMatch: {
                            marketplaceId: new Types.ObjectId(mpId),
                            externalId: { $in: extIds },
                        },
                    },
                    active: true,
                } as any)
                .select('_id name breadcrumbs marketplaceMappings')
                .lean()
                .exec();

            for (const c of categories as any[]) {
                const mappings = Array.isArray(c?.marketplaceMappings) ? c.marketplaceMappings : [];
                for (const m of mappings) {
                    if (
                        String(m?.marketplaceId || '') === mpId &&
                        extIds.includes(String(m?.externalId || ''))
                    ) {
                        mapped.set(`${mpId}:${String(m.externalId)}`, {
                            id: String(c._id),
                            name: String(c.name || ''),
                            breadcrumbs: c?.breadcrumbs ? String(c.breadcrumbs) : '',
                            mlExternalId: String(m.externalId || ''),
                            mlExternalName: m?.externalName ? String(m.externalName) : '',
                            mlPath: m?.path ? String(m.path) : '',
                            marketplaceMappings: mappings,
                        });
                    }
                }
            }
        }

        return mapped;
    }
}
