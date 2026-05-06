import { Controller, Get, Param, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalHeader } from './internal-header.decorator';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';

@Controller('internal')
export class InternalController {
    constructor(
        private readonly config: ConfigService,
        private readonly registryService: MarketplaceRegistryService,
        private readonly authService: MarketplaceAuthService,
    ) {}

    @Get('token/:tag')
    @InternalHeader()
    async getToken(@Param('tag') tag: string) {
        const marketplace = await this.registryService.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace "${tag}" not found`);

        const resolved = await this.authService.ensureValidToken(marketplace._id as any);
        if (!resolved?.accessToken) throw new NotFoundException(`No valid token for "${tag}"`);

        return { token: resolved.accessToken };
    }
}
