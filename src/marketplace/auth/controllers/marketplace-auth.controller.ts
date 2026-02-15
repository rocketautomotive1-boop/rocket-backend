import { Controller, Get, Post, Body, Param, Query, BadRequestException, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';

@ApiTags('marketplace-auth')
@Controller('marketplaces')
export class MarketplaceAuthController {
    constructor(
        private readonly marketplaceAuthService: MarketplaceAuthService,
        private readonly marketplaceService: MarketplaceService,
    ) { }

    @Get(':tag/oauth-url')
    @ApiOperation({ summary: 'Gerar URL de autorização OAuth' })
    @ApiResponse({ status: 200, description: 'URL de autorização gerada com sucesso' })
    @ApiResponse({ status: 400, description: 'Parâmetros inválidos' })
    @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
    async generateOAuthUrl(
        @Param('tag') tag: string,
        @Query('redirectUri') redirectUri: string,
    ): Promise<{ authUrl: string }> {
        if (!redirectUri) {
            throw new BadRequestException('O parâmetro redirectUri é obrigatório');
        }

        const marketplace = await this.marketplaceService.findByTag(tag);

        if (!marketplace) {
            throw new BadRequestException(`Marketplace com tag ${tag} não encontrado`);
        }

        // Now generic for all adapters supported by auth service
        return this.marketplaceAuthService.generateAuthUrl(marketplace.id || marketplace._id, redirectUri);
    }

    @Post(':tag/token')
    @ApiOperation({ summary: 'Salvar token de acesso para um marketplace' })
    @ApiResponse({ status: 201, description: 'Token salvo com sucesso' })
    async saveToken(
        @Param('tag') tag: string,
        @Body() tokenData: Partial<MarketplaceToken>,
    ): Promise<MarketplaceToken> {
        const marketplace = await this.marketplaceService.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace com tag ${tag} não encontrado`);
        return this.marketplaceAuthService.saveToken(marketplace.id || marketplace._id, tokenData);
    }

    @Post(':tag/refresh-token')
    @ApiOperation({ summary: 'Atualizar token de acesso para um marketplace' })
    @ApiResponse({ status: 200, description: 'Token atualizado com sucesso' })
    async refreshToken(@Param('tag') tag: string): Promise<MarketplaceToken> {
        // Note: MarketplaceService.refreshToken delegated to AuthService usually, or we can go direct.
        // The original controller called MarketplaceService.refreshToken.
        // Let's check MarketplaceService.refreshToken implementation to be sure.
        // For now I'll use MarketplaceService to be safe, or check if AuthService has it.
        // AuthService has refreshToken(id, token).
        // MarketplaceService likely orchestrates fetching the token and calling auth service.
        const marketplace = await this.marketplaceService.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace com tag ${tag} não encontrado`);
        return this.marketplaceService.refreshToken(marketplace.id || marketplace._id);
    }

    @Post(':tag/update-access-token')
    @ApiOperation({ summary: 'Atualizar manualmente access_token (para Shopee sandbox)' })
    @ApiResponse({ status: 200, description: 'Access token atualizado com sucesso' })
    @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
    async updateAccessToken(
        @Param('tag') tag: string,
        @Body() data: { accessToken: string; expiresIn?: number },
    ): Promise<{ success: boolean; message: string; token: MarketplaceToken }> {
        const marketplace = await this.marketplaceService.findByTag(tag);

        if (!marketplace) {
            throw new NotFoundException(`Marketplace com tag ${tag} não encontrado`);
        }

        const id = marketplace.id || marketplace._id;

        // Get existing token to preserve refresh_token and other data
        const existingToken = await this.marketplaceAuthService.ensureValidToken(id);

        if (!existingToken) {
            throw new NotFoundException(`Nenhum token encontrado para o marketplace ${marketplace.name}`);
        }

        // Update only the access_token and expiresAt
        const expiresIn = data.expiresIn || 14400; // Default 4 hours (Shopee default)
        const updatedTokenData = {
            ...existingToken,
            accessToken: data.accessToken,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            isActive: true,
        };

        const updatedToken = await this.marketplaceAuthService.saveToken(id, updatedTokenData);

        return {
            success: true,
            message: `Access token atualizado com sucesso para ${marketplace.name}`,
            token: updatedToken,
        };
    }

    @Post(':tag/authenticate')
    @ApiOperation({ summary: 'Autenticar com marketplace (OAuth)' })
    @ApiResponse({ status: 200, description: 'Autenticação realizada com sucesso' })
    @ApiResponse({ status: 400, description: 'Parâmetros inválidos' })
    @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
    async authenticate(
        @Param('tag') tag: string,
        @Body() authData: { code: string; redirectUri?: string; shopId?: string; authorizationCode?: string },
    ): Promise<MarketplaceToken> {
        // Normalizar code/authorizationCode
        const finalCode = authData.code || authData.authorizationCode;

        if (!finalCode) {
            throw new BadRequestException('O parâmetro code ou authorizationCode é obrigatório');
        }

        const marketplace = await this.marketplaceService.findByTag(tag);
        if (!marketplace) throw new NotFoundException(`Marketplace com tag ${tag} não encontrado`);

        return this.marketplaceAuthService.authenticate(marketplace.id || marketplace._id, {
            ...authData,
            code: finalCode
        });
    }
}
