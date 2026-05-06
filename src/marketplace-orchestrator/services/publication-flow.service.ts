import { Injectable, HttpStatus } from '@nestjs/common';
import { PublicationContextService } from './publication-context.service';
import { MarketplaceOrchestratorService } from '../marketplace-orchestrator.service';
import { SyncQueueService } from './sync-queue.service';
import { ListingRemovalService } from './listing-removal.service';
import { PayloadBuilderService } from './payload-builder.service';
import { MarketplaceIssuesService } from './marketplace-issues.service';
import { MercadoLivreComplianceService } from './mercadolivre-compliance.service';
import { OperationalIssuesService } from './operational-issues.service';
import { OrchestratorPublisherService } from '../orchestrator-publisher.service';

@Injectable()
export class PublicationFlowService {
    constructor(
        private readonly orchestratorService: MarketplaceOrchestratorService,
        private readonly contextService: PublicationContextService,
        private readonly syncQueueService: SyncQueueService,
        private readonly listingRemovalService: ListingRemovalService,
        private readonly payloadBuilderService: PayloadBuilderService,
        private readonly marketplaceIssuesService: MarketplaceIssuesService,
        private readonly operationalIssuesService: OperationalIssuesService,
        private readonly mercadoLivreComplianceService: MercadoLivreComplianceService,
        private readonly orchestratorPublisher: OrchestratorPublisherService,
    ) {}

    async publishListing(listingId: string, requesterId?: string) {
        const context = await this.contextService.buildContext(listingId, requesterId);
        const jobId = await this.orchestratorService.publishListing(context, requesterId, true, undefined, 'user_publish');
        return {
            message: 'Marketplace publication job scheduled',
            jobId,
            listingId,
        };
    }

    async syncProduct(productId: string, requesterId?: string) {
        const msEnabled = process.env.ORCHESTRATOR_MS_ENABLED === 'true';

        if (msEnabled) {
            await this.orchestratorPublisher.requestSync({
                productId,
                reason: 'user_publish',
                force: true,
                requesterId,
                resolutionSignal: 'user_publish',
            });
            return { queued: true, via: 'orchestrator-ms' };
        }

        const enqueue = await this.syncQueueService.enqueue({
            productId,
            requesterId,
            force: true,
            reason: 'user_publish',
            resolutionSignal: 'user_publish',
        });

        if (enqueue.queued === false) {
            const skipped = enqueue;
            return {
                message: skipped.reason === 'blocked_by_post_publish_review'
                    ? 'Product sync skipped: blocked marketplace issues require relevant data changes'
                    : 'Product sync skipped: product is not ready to publish',
                productId,
                queued: false,
                readyToPublish: skipped.readyToPublish,
                missingRequiredSections: skipped.missingRequiredSections,
                completion: skipped.completion,
                blockedMarketplaceIds: skipped.blockedMarketplaceIds || [],
                blockedMarketplaces: skipped.blockedMarketplaces || [],
            };
        }

        return {
            message: 'Product sync queued',
            productId,
            queued: true,
            readyToPublish: true,
            missingRequiredSections: [],
        };
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

    async payloadPreviewByProduct(productId: string) {
        return this.payloadBuilderService.buildPreviewByProduct(productId);
    }

    async payloadPreview(listingId: string, action?: 'CREATE' | 'UPDATE') {
        return this.payloadBuilderService.buildPreview(listingId, action);
    }

    async listIssues(params: {
        marketplaceTag?: string;
        status?: 'blocked' | 'all';
        classifier?: string;
        productId?: string;
        limit?: string;
        offset?: string;
    }) {
        return this.marketplaceIssuesService.listIssues({
            marketplaceTag: params.marketplaceTag,
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
        await this.mercadoLivreComplianceService.runAllChecks();
        return { message: 'Mercado Livre compliance checks executed' };
    }
}
