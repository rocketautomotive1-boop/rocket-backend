import { Injectable, HttpStatus } from '@nestjs/common';
import { ListingRemovalService } from './listing-removal.service';
import { MarketplaceIssuesService } from './marketplace-issues.service';
import { OperationalIssuesService } from './operational-issues.service';
import { OrchestratorPublisherService } from '../orchestrator-publisher.service';

@Injectable()
export class PublicationFlowService {
    constructor(
        private readonly listingRemovalService: ListingRemovalService,
        private readonly marketplaceIssuesService: MarketplaceIssuesService,
        private readonly operationalIssuesService: OperationalIssuesService,
        private readonly orchestratorPublisher: OrchestratorPublisherService,
    ) {}

    async syncProduct(productId: string, requesterId?: string, marketplaceIds?: string[]) {
        await this.orchestratorPublisher.requestSync({
            productId,
            reason: 'user_publish',
            requesterId,
            resolutionSignal: 'user_publish',
            targetMarketplaceIds: marketplaceIds?.length ? marketplaceIds : undefined,
        });
        return { queued: true, via: 'orchestrator-ms' };
    }

    async removeListing(listingId: string, requesterId?: string) {
        const result = await this.listingRemovalService.removeListing(listingId, requesterId);

        if (result.removed) {
            return {
                message: result.warning || 'Listing removed successfully',
                ...result,
            };
        }

        return {
            statusCode: HttpStatus.ACCEPTED,
            message: 'Listing removal job dispatched to marketplace',
            ...result,
        };
    }

    async listIssues(params: {
        marketplaceTag?: string;
        storeId?: string;
        status?: 'blocked' | 'all';
        classifier?: string;
        productId?: string;
        limit?: string;
        offset?: string;
    }) {
        return this.marketplaceIssuesService.listIssues({
            marketplaceTag: params.marketplaceTag,
            storeId: params.storeId,
            status: params.status,
            classifier: params.classifier,
            productId: params.productId,
            limit: params.limit ? Number(params.limit) : 20,
            offset: params.offset ? Number(params.offset) : 0,
        });
    }

    async getIssue(listingId: string) {
        return this.marketplaceIssuesService.getIssueByListing(listingId);
    }

    async listOperationalIssues(params: {
        marketplaceTag?: string;
        status?: 'blocked' | 'all';
        classifier?: string;
        productId?: string;
        limit?: string;
        offset?: string;
    }) {
        return this.operationalIssuesService.listIssues({
            marketplaceTag: params.marketplaceTag,
            status: params.status,
            classifier: params.classifier,
            productId: params.productId,
            limit: params.limit ? Number(params.limit) : 20,
            offset: params.offset ? Number(params.offset) : 0,
        });
    }

    async getOperationalIssue(listingId: string) {
        return this.operationalIssuesService.getIssueByListing(listingId);
    }

    async resolveIssueSignal(listingId: string, resolutionSignal: string, requesterId?: string) {
        return this.marketplaceIssuesService.resolveSignal(listingId, resolutionSignal, requesterId);
    }

    async retryIssue(listingId: string, requesterId?: string) {
        return this.marketplaceIssuesService.retryIssue(listingId, requesterId);
    }

    async recreateIssue(listingId: string, requesterId?: string) {
        return this.marketplaceIssuesService.recreateIssue(listingId, requesterId);
    }

    async runComplianceChecks() {
        // Compliance checks migrated to orchestrator-ms
        return { message: 'Mercado Livre compliance checks delegated to orchestrator-ms' };
    }
}
