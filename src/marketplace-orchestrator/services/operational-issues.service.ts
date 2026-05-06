import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';

@Injectable()
export class OperationalIssuesService {
    private readonly operationalClassifiers = new Set<string>([
        'TEMPORARY_LOCK',
        'AUTH_OR_PERMISSION_ISSUE',
        'GENERIC_SYNC_FAILURE',
        'CATEGORY_VALIDATION_REQUIRED',
        'CATALOG_VALIDATION_REQUIRED',
        'ATTRIBUTE_VALIDATION_REQUIRED',
        'DIMENSION_FORMAT_INVALID',
    ]);

    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
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
                $in: Array.from(this.operationalClassifiers),
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

        return {
            items: items.map((l: any) => this.buildIssueView(l)),
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
        return this.buildIssueView(listing as any);
    }

    private buildIssueView(listing: any) {
        const classifier = String(listing.marketplaceData?.syncIssue?.classifier || '').toUpperCase();
        const closedReason = String(listing.marketplaceData?.closedReason || '').toLowerCase();
        const recreateRequiredRaw = listing.marketplaceData?.recreateRequired === true;
        const recreateRequiredEffective =
            recreateRequiredRaw &&
            (classifier === 'TERMINAL_RECREATE' || (!classifier && closedReason === 'wrong_category'));

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
            moderation: null,
            closedReason,
            recreateRequired: recreateRequiredEffective,
            lastSyncAt: listing.lastSyncAt || null,
            updatedAt: listing.updatedAt || null,
        };
    }
}
