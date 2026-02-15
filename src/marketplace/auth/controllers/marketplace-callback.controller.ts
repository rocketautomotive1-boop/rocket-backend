import { Controller, Get, Query, Param, BadRequestException, NotFoundException, Res, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('auth')
@Controller('auth')
export class MarketplaceCallbackController {
    constructor(
        private readonly marketplaceAuthService: MarketplaceAuthService,
        private readonly marketplaceService: MarketplaceService,
        private readonly configService: ConfigService,
    ) { }

    @Get(':tag/callback')
    @ApiOperation({ summary: 'Callback de autenticação do marketplace' })
    @ApiResponse({ status: 200, description: 'Autenticação realizada com sucesso' })
    @ApiResponse({ status: 400, description: 'Código de autorização não fornecido' })
    async handleCallback(
        @Param('tag') tag: string,
        @Query('code') code: string,
        @Query('shop_id') shopId: string, // Shopee uses shop_id
        @Res() res, // Inject Response to allow redirect or custom HTML
        @Req() req,
    ) {
        if (!code) {
            throw new BadRequestException('Código de autorização não fornecido');
        }

        const marketplace = await this.marketplaceService.findByTag(tag);
        if (!marketplace) {
            throw new NotFoundException(`Marketplace com tag ${tag} não encontrado`);
        }

        try {
            // Construct redirectUri using API_BASE_URL from env, or fallback to request headers
            const apiBaseUrl = this.configService.get<string>('API_BASE_URL');
            let redirectUri: string;

            if (apiBaseUrl) {
                redirectUri = `${apiBaseUrl}/auth/${tag}/callback`;
            } else {
                const protocol = req.headers['x-forwarded-proto'] || req.protocol;
                const host = req.headers['x-forwarded-host'] || req.headers.host;
                redirectUri = `${protocol}://${host}/auth/${tag}/callback`;
            }

            // Include extra query params that might be needed (e.g. shop_id for Shopee)
            const authData = {
                code,
                shopId,
                redirectUri,
            };

            await this.marketplaceAuthService.authenticate(marketplace.id || marketplace._id, authData);

            // Return a simple success page or JSON?
            // User didn't specify, but for a browser redirect callback, a nice HTML page is better.
            return res.status(200).send(`
                <html>
                    <head>
                        <title>Autenticação Sucesso</title>
                        <style>
                            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f2f5; }
                            .container { padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
                            h1 { color: #10b981; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>Autenticado com Sucesso!</h1>
                            <p>O marketplace ${marketplace.name} foi conectado corretamente.</p>
                            <p>Você pode fechar esta janela.</p>
                        </div>
                    </body>
                </html>
            `);

        } catch (error) {
            return res.status(500).send(`
                <html>
                    <head>
                        <title>Erro na Autenticação</title>
                        <style>
                            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f2f5; }
                            .container { padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
                            h1 { color: #ef4444; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>Falha na Autenticação</h1>
                            <p>Não foi possível conectar o marketplace ${marketplace.name}.</p>
                            <p>Erro: ${error.message}</p>
                        </div>
                    </body>
                </html>
            `);
        }
    }
}
