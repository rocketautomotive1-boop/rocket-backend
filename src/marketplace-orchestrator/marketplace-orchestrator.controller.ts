import { Controller, Post, Delete, Get, Param, Query, Request, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';
import { PublicationContextService } from './services/publication-context.service';
import { SyncQueueService } from './services/sync-queue.service';
import { ListingRemovalService } from './services/listing-removal.service';
import { PayloadBuilderService } from './services/payload-builder.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('marketplace-orchestrator')
export class MarketplaceOrchestratorController {
    constructor(
        private readonly orchestratorService: MarketplaceOrchestratorService,
        private readonly contextService: PublicationContextService,
        private readonly syncQueueService: SyncQueueService,
        private readonly listingRemovalService: ListingRemovalService,
        private readonly payloadBuilderService: PayloadBuilderService,
    ) { }

    /**
     * Manual publish for a single listing.
     * Bypasses the SyncQueue and dispatches directly with force=true so the
     * AtomicGuard is skipped — the user explicitly chose to publish this listing.
     */
    @Post('publish/:listingId')
    @HttpCode(HttpStatus.ACCEPTED)
    async publishListing(@Param('listingId') listingId: string, @Request() req: any) {
        const requesterId = req.user?.id;
        const context = await this.contextService.buildContext(listingId, requesterId);
        const jobId = await this.orchestratorService.publishListing(context, requesterId, true);
        return {
            message: 'Marketplace publication job scheduled',
            jobId,
            listingId,
        };
    }

    /**
     * Explicit product sync — enqueues a sync for all listings of a product.
     * Called by the frontend after the user commits all stepper sections.
     *
     * This goes through the SyncQueue (not the orchestrator directly) so that:
     * - Multiple rapid calls from the frontend collapse into a single queue entry.
     * - Retry with exponential backoff is available if the marketplace API is unavailable.
     * - The queue is the single source of truth for pending syncs.
     *
     * force=true so the AtomicGuard inside publishListing() is bypassed — the user
     * has explicitly saved and expects the listing to be published regardless of any
     * pre-existing pending_creation status.
     */
    @Post('sync-product/:productId')
    @HttpCode(HttpStatus.ACCEPTED)
    async syncProduct(@Param('productId') productId: string, @Request() req: any) {
        const requesterId = req.user?.id;
        await this.syncQueueService.enqueue({
            productId,
            requesterId,
            force: true,
            reason: 'user_publish',
        });
        return {
            message: 'Product sync queued',
            productId,
        };
    }

    /**
     * Remove a listing. If published (has externalId), dispatches an unpublish
     * job to the marketplace via RabbitMQ. Admin-only for published listings.
     */
    @Delete('listings/:listingId')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin')
    async removeListing(@Param('listingId') listingId: string, @Request() req: any) {
        const requesterId = req.user?.id;
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

    /**
     * Bulk preview: returns payloads for ALL listings of a product across all marketplaces.
     * Must be registered before the :listingId route to avoid "product" being captured as a param.
     */
    @Get('payload-preview/product/:productId')
    async payloadPreviewByProduct(@Param('productId') productId: string) {
        return this.payloadBuilderService.buildPreviewByProduct(productId);
    }

    /**
     * Returns the marketplace-specific payload that WOULD be sent on publish,
     * without actually dispatching anything. Useful for debugging and validation.
     *
     * ?action=CREATE|UPDATE  — force a specific action (default: auto-detect from listing.externalId)
     */
    @Get('payload-preview/:listingId')
    async payloadPreview(
        @Param('listingId') listingId: string,
        @Query('action') action?: 'CREATE' | 'UPDATE',
    ) {
        return this.payloadBuilderService.buildPreview(listingId, action);
    }
}
