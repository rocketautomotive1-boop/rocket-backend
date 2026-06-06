import { Controller, Get, Query, Param, BadRequestException, NotFoundException, Res, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceTokenBrokerService } from '../services/marketplace-token-broker.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('auth')
@Controller()
export class MarketplaceCallbackController {
    constructor(
        private readonly marketplaceAuthService: MarketplaceAuthService,
        private readonly broker: MarketplaceTokenBrokerService,
        private readonly marketplaceService: MarketplaceService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Callback OAuth de CONTA (multi-client) ancorado na RAIZ.
     * A app ML tem a redirect_uri registrada como a raiz (https://.../) e o ML
     * exige match EXATO — não aceita path. Então recebemos o callback aqui e
     * usamos o `state` (=accountId) para saber qual conta autorizar.
     *
     * Guarda: só age como callback quando vêm `code` E `state`. Sem eles,
     * responde neutro (não interfere em health/probe na raiz).
     */
    @Get()
    @ApiOperation({ summary: 'Callback OAuth de conta na raiz (redirect_uri = raiz, match exato do ML)' })
    async handleRootAccountCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res,
    ) {
        if (!code || !state) {
            return res.status(200).send('OK');
        }
        try {
            const apiBaseUrl = this.configService.get<string>('API_BASE_URL') ?? '';
            // redirect_uri da troca DEVE ser idêntica à da autorização: a raiz.
            await this.broker.handleAuthCallback(state, code, apiBaseUrl);
            return res.status(200).send(this.successHtml('A conta foi conectada corretamente.'));
        } catch (error) {
            return res.status(500).send(this.errorHtml(error?.message ?? 'Falha desconhecida'));
        }
    }

    // HTML compartilhado pelos dois fluxos de callback (raiz multi-client e /auth/:tag/callback).
    private successHtml(msg: string): string {
        return `<html><head><title>Autenticação</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5}.c{padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);text-align:center}h1{color:#10b981}</style></head><body><div class="c"><h1>Autenticado com Sucesso!</h1><p>${msg}</p><p>Você pode fechar esta janela.</p></div></body></html>`;
    }

    private errorHtml(msg: string): string {
        return `<html><head><title>Erro</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5}.c{padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);text-align:center}h1{color:#ef4444}</style></head><body><div class="c"><h1>Falha na Autenticação</h1><p>Erro: ${msg}</p></div></body></html>`;
    }

    /** Generic OAuth callback: GET /auth/:tag/callback */
    @Get('auth/:tag/callback')
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
            return res.status(200).send(this.successHtml(`O marketplace ${marketplace.name} foi conectado corretamente.`));
        } catch (error) {
            return res.status(500).send(this.errorHtml(error?.message ?? 'Falha desconhecida'));
        }
    }

    /**
     * OLX-specific callback alias: GET /olx/callback
     * OLX redirect_uri is registered as https://www.rocketautomotive.com.br/olx/callback
     * and cannot be changed without updating the OLX app registration.
     */
    @Get('olx/callback')
    @ApiOperation({ summary: 'Callback OAuth da OLX (alias para /auth/olx/callback)' })
    async handleOLXCallback(
        @Query('code') code: string,
        @Query('state') _state: string,
        @Res() res,
        @Req() req,
    ) {
        return this.handleCallback('olx', code, undefined, res, req);
    }
}
