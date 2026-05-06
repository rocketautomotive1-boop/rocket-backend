import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';

@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalTokenController {
    constructor(
        private readonly authService: MarketplaceAuthService,
        private readonly registry: MarketplaceRegistryService,
    ) {}

    /**
     * Returns a valid access token for the requested marketplace tag.
     * Intended for internal microservices only — protected by x-internal-key header.
     *
     * Usage: GET /internal/token/mercadolivre
     *        GET /internal/token/shopee
     */
    @Get('token/:tag')
    async getToken(@Param('tag') tag: string) {
        const marketplace = await this.registry.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

        const resolved = await this.authService.ensureValidToken(marketplace._id.toString());
        if (!resolved?.accessToken) throw new NotFoundException(`No active token for marketplace: ${tag}`);

        return { token: resolved };
    }
}
