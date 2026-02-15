import { Controller, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';
import { PublicationContextService } from './services/publication-context.service';

@Controller('marketplace-orchestrator')
export class MarketplaceOrchestratorController {
    constructor(
        private readonly orchestratorService: MarketplaceOrchestratorService,
        private readonly contextService: PublicationContextService
    ) { }

    @Post('publish/:listingId')
    @HttpCode(HttpStatus.ACCEPTED)
    async publishListing(@Param('listingId') listingId: string) {
        const context = await this.contextService.buildContext(listingId);
        const jobId = await this.orchestratorService.publishListing(context);
        return {
            message: 'Marketplace publication job scheduled',
            jobId,
            listingId
        };
    }
}
