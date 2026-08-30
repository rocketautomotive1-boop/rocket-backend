import { Controller, Post, Delete, Get, Param, Query, Request, HttpCode, HttpStatus, UseGuards, Body } from '@nestjs/common';
import { PublicationFlowService } from './services/publication-flow.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('marketplace-orchestrator')
export class MarketplaceOrchestratorController {
    constructor(
        private readonly publicationFlowService: PublicationFlowService,
    ) { }

    /**
     * Explicit product sync — enqueues a sync for all listings of a product.
     * Called by the frontend after the user commits all stepper sections.
     * Routes through orchestrator-ms via OrchestratorPublisherService.
     */
    @Post('sync-product/:productId')
    @HttpCode(HttpStatus.ACCEPTED)
    async syncProduct(
        @Param('productId') productId: string,
        @Request() req: any,
        @Body('marketplaceIds') marketplaceIds?: string[],
    ) {
        const requesterId = req.user?.id;
        return this.publicationFlowService.syncProduct(productId, requesterId, marketplaceIds);
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
        return this.publicationFlowService.removeListing(listingId, requesterId);
    }

    @Get('issues')
    async listIssues(
        @Query('marketplaceTag') marketplaceTag?: string,
        @Query('storeId') storeId?: string,
        @Query('status') status?: 'blocked' | 'all',
        @Query('classifier') classifier?: string,
        @Query('productId') productId?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.publicationFlowService.listIssues({
            marketplaceTag,
            storeId,
            status,
            classifier,
            productId,
            limit,
            offset,
        });
    }

    @Get('issues/:listingId')
    async getIssue(@Param('listingId') listingId: string) {
        return this.publicationFlowService.getIssue(listingId);
    }

    @Get('operational-issues')
    async listOperationalIssues(
        @Query('marketplaceTag') marketplaceTag?: string,
        @Query('status') status?: 'blocked' | 'all',
        @Query('classifier') classifier?: string,
        @Query('productId') productId?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.publicationFlowService.listOperationalIssues({
            marketplaceTag,
            status,
            classifier,
            productId,
            limit,
            offset,
        });
    }

    @Get('operational-issues/:listingId')
    async getOperationalIssue(@Param('listingId') listingId: string) {
        return this.publicationFlowService.getOperationalIssue(listingId);
    }

    @Post('issues/:listingId/resolve-signal')
    @HttpCode(HttpStatus.ACCEPTED)
    async resolveIssueSignal(
        @Param('listingId') listingId: string,
        @Body('resolutionSignal') resolutionSignal: string,
        @Request() req: any,
    ) {
        return this.publicationFlowService.resolveIssueSignal(listingId, resolutionSignal, req.user?.id);
    }

    @Post('issues/:listingId/retry')
    @HttpCode(HttpStatus.ACCEPTED)
    async retryIssue(@Param('listingId') listingId: string, @Request() req: any) {
        return this.publicationFlowService.retryIssue(listingId, req.user?.id);
    }

    @Post('issues/:listingId/recreate')
    @HttpCode(HttpStatus.ACCEPTED)
    async recreateIssue(@Param('listingId') listingId: string, @Request() req: any) {
        return this.publicationFlowService.recreateIssue(listingId, req.user?.id);
    }

    @Post('issues/compliance/run')
    @HttpCode(HttpStatus.ACCEPTED)
    async runComplianceChecks() {
        return this.publicationFlowService.runComplianceChecks();
    }
}
