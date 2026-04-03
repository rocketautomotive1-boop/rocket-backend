import { Controller, Get, Query, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { OLXAuthService } from './olx-auth.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { SkipJwtAuth } from '../../../auth/decorators/skip-jwt-auth.decorator';

@ApiTags('OLX Auth Callback')
@Controller('olx')
export class OLXCallbackController {
    private readonly logger = new Logger(OLXCallbackController.name);

    constructor(
        private readonly olxAuthService: OLXAuthService,
        private readonly marketplaceService: MarketplaceService,
    ) { }

    /**
     * OAuth2 callback endpoint — receives the authorization code from OLX after user consent.
     * OLX redirects to: https://www.rocketautomotive.com.br/olx/callback?code=xxx&state=/profile
     */
    @Get('callback')
    @SkipJwtAuth()
    @ApiOperation({ summary: 'OLX OAuth2 callback — troca authorization code por access token' })
    @ApiQuery({ name: 'code', description: 'Authorization code retornado pela OLX' })
    @ApiQuery({ name: 'state', required: false, description: 'State parameter (ignorado)' })
    @ApiResponse({ status: 200, description: 'Token salvo com sucesso' })
    @ApiResponse({ status: 400, description: 'Code inválido ou marketplace não encontrado' })
    async handleCallback(
        @Query('code') code: string,
        @Query('state') state?: string,
    ) {
        if (!code) {
            throw new BadRequestException('Authorization code ausente na callback da OLX');
        }

        this.logger.log(`[OLX Callback] Received authorization code (state=${state})`);

        const marketplace = await this.marketplaceService.findByName('OLX');
        if (!marketplace) {
            throw new BadRequestException('Marketplace OLX não encontrado no banco de dados');
        }

        const savedToken = await this.olxAuthService.processCallbackCode(code, marketplace);

        this.logger.log(`[OLX Callback] Token saved successfully for marketplace ${marketplace._id}`);

        return {
            success: true,
            message: 'Token OLX salvo com sucesso. Integração autorizada.',
            expiresAt: savedToken?.expiresAt,
        };
    }
}
