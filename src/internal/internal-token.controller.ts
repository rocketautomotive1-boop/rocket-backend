import { Controller, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceAccountService } from '../marketplace/auth/services/marketplace-account.service';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';

@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalTokenController {
    constructor(
        private readonly authService: MarketplaceAuthService,
        private readonly accountService: MarketplaceAccountService,
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

    /**
     * Token válido da CONTA que atende o domínio (multi-client). Caminho paralelo
     * ao /token/:tag (default). Resolve via accountFor(domain) → ensureValidAccountToken.
     *
     * Usage: GET /internal/token/account/mercadolivre/general
     */
    @Get('token/account/:tag/:domain')
    async getAccountToken(@Param('tag') tag: string, @Param('domain') domain: string) {
        const marketplace = await this.registry.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

        const account = await this.accountService.accountFor(marketplace._id.toString(), domain);
        if (!account) throw new NotFoundException(`No account for ${tag}/${domain}`);

        const token = await this.accountService.ensureValidAccountToken(String((account as any)._id));
        return { token, accountLabel: (account as any).label };
    }
}
