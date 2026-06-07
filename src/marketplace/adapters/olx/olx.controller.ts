import { Controller, Post, Get, Put, Delete, Body, Param, Query, Headers, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { OLXProductAdapter } from './olx-product.adapter';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { MarketplaceService } from '../../services/marketplace.service';

@ApiTags('OLX Marketplace')
@Controller('marketplace/olx')
export class OLXController {
  private readonly name = 'OLX';
  constructor(
    private readonly olxAdapter: OLXProductAdapter,
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => MarketplaceService))
    private readonly marketplaceService: MarketplaceService,
  ) { }

  private extractToken(auth: string | undefined): string {
    if (!auth) {
      throw new BadRequestException('Authorization header is required');
    }
    if (!auth.startsWith('Bearer ')) {
      throw new BadRequestException('Authorization header must start with "Bearer "');
    }
    return auth.replace('Bearer ', '');
  }

  // ===== AUTENTICAÇÃO =====
  // Nota: autenticação OAuth padrão via sistema centralizado:
  //   GET  /marketplaces/olx/oauth-url?redirectUri=...   → gerar URL
  //   POST /marketplaces/olx/authenticate  { code }      → trocar code por token
  //   POST /marketplaces/olx/refresh-token              → renovar token
  //   GET  /auth/olx/callback?code=...                  → callback OAuth

  @Post('auth/auto-authenticate')
  @ApiOperation({ summary: 'Realizar autenticação automática na OLX' })
  @ApiResponse({ status: 200, description: 'Autenticação automática realizada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async performAutoAuthentication() {
    return await this.olxAdapter.performAutoAuthentication();
  }

  @Get('auth/status')
  @ApiOperation({ summary: 'Verificar status dos tokens da OLX' })
  @ApiResponse({ status: 200, description: 'Status dos tokens consultado com sucesso' })
  async checkTokenStatus() {
    return await this.olxAdapter.checkTokenStatus();
  }

  @Get('auth/config-test')
  @ApiOperation({ summary: 'Testar configurações de ambiente da OLX' })
  @ApiResponse({ status: 200, description: 'Configurações testadas com sucesso' })
  async testConfig() {
    return {
      message: 'Teste de configurações da OLX',
      configs: {
        clientId: this.configService.get('OLX_CLIENT_ID'),
        clientSecret: this.configService.get('OLX_CLIENT_SECRET_' + this.configService.get('OLX_CLIENT_ID')),
        // NOTE: authoritative source é marketplaces.settings.redirectUri (fallback .env). Aqui ecoa apenas a env por ser endpoint de debug.
        redirectUri: this.configService.get('OLX_REDIRECT_URI'),
        allEnvVars: {
          OLX_CLIENT_ID: process.env.OLX_CLIENT_ID,
          OLX_REDIRECT_URI: process.env.OLX_REDIRECT_URI,
          NODE_ENV: process.env.NODE_ENV,
          PORT: process.env.PORT
        }
      }
    };
  }

  @Post('auth/test-credentials')
  @ApiOperation({ summary: 'Testar credenciais da OLX sem autenticação completa' })
  @ApiResponse({ status: 200, description: 'Credenciais testadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Credenciais inválidas' })
  async testCredentials() {
    try {
      const marketplace = await this.marketplaceService.findByName('OLX');

      if (!marketplace) {
        throw new Error('Marketplace OLX não encontrado no banco de dados');
      }

      const clientId = marketplace.appId;
      const clientSecret = this.configService.get(`OLX_CLIENT_SECRET_${clientId}`);

      if (!clientId || !clientSecret) {
        return {
          success: false,
          error: 'Credenciais não configuradas',
          details: {
            clientId: clientId || 'não configurado',
            clientSecret: clientSecret ? 'configurado' : 'não configurado',
            marketplace: marketplace ? 'encontrado' : 'não encontrado'
          }
        };
      }

      // Testar apenas a conectividade com a API da OLX
      try {
        const response = await this.httpService.get('https://auth.olx.com.br/oauth', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
          }
        }).toPromise();

        return {
          success: true,
          message: 'Credenciais configuradas e conectividade OK',
          details: {
            clientId: clientId,
            clientSecretConfigured: !!clientSecret,
            marketplaceFound: true,
            olxApiAccessible: response.status === 200,
            responseStatus: response.status
          }
        };
      } catch (connectivityError) {
        return {
          success: false,
          error: 'Problema de conectividade com a API da OLX',
          details: {
            clientId: clientId,
            clientSecretConfigured: !!clientSecret,
            marketplaceFound: true,
            olxApiAccessible: false,
            connectivityError: connectivityError.message,
            status: connectivityError.response?.status
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: {
          stack: error.stack
        }
      };
    }
  }

  // ===== IMPORTAÇÃO DE ANÚNCIOS =====

  @Post('ads/import')
  @ApiOperation({ summary: 'Importar anúncio na OLX' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Anúncio importado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async importAd(@Body() product: any) {
    return await this.olxAdapter.importAd(product);
  }

  @Delete('ads/:adId')
  @ApiOperation({ summary: 'Excluir anúncio da OLX' })
  @ApiParam({ name: 'adId', description: 'ID do anúncio' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Anúncio excluído com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async deleteAd(@Param('adId') adId: string) {
    return await this.olxAdapter.deleteAd(adId);
  }

  @Get('imports/:importId/status')
  @ApiOperation({ summary: 'Consultar status de importação' })
  @ApiParam({ name: 'importId', description: 'ID da importação' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Status consultado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getImportStatus(@Param('importId') importId: string) {
    return await this.olxAdapter.getImportStatus(importId);
  }

  @Post('ads')
  @ApiOperation({ summary: 'Listar anúncios publicados na OLX' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Anúncios listados com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getPublishedAds(@Body() params: any = {}) {
    return await this.olxAdapter.getPublishedAds(params);
  }

  // ===== CATÁLOGO =====

  @Post('catalog/car-brands')
  @ApiOperation({ summary: 'Consultar marcas de carros' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Marcas consultadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getCarBrands(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getCarBrands(accessToken);
  }

  @Post('catalog/car-brands/:brandId/models')
  @ApiOperation({ summary: 'Consultar modelos de carros por marca' })
  @ApiParam({ name: 'brandId', description: 'ID da marca' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Modelos consultados com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getCarModels(
    @Headers('authorization') auth: string,
    @Param('brandId') brandId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getCarModels(accessToken, brandId);
  }

  @Post('catalog/motorcycle-brands')
  @ApiOperation({ summary: 'Consultar marcas de motos' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Marcas consultadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getMotorcycleBrands(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getMotorcycleBrands(accessToken);
  }

  @Post('catalog/motorcycle-brands/:brandId/models')
  @ApiOperation({ summary: 'Consultar modelos de motos por marca' })
  @ApiParam({ name: 'brandId', description: 'ID da marca' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Modelos consultados com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getMotorcycleModels(
    @Headers('authorization') auth: string,
    @Param('brandId') brandId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getMotorcycleModels(accessToken, brandId);
  }

  @Post('catalog/categories')
  @ApiOperation({ summary: 'Consultar categorias' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Categorias consultadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getCategories(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getCategories(accessToken);
  }

  @Post('catalog/categories/:categoryId/subcategories')
  @ApiOperation({ summary: 'Consultar subcategorias' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Subcategorias consultadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getSubcategories(
    @Headers('authorization') auth: string,
    @Param('categoryId') categoryId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getSubcategories(accessToken, categoryId);
  }

  // ===== DESTAQUES E SALDOS =====

  @Post('balance')
  @ApiOperation({ summary: 'Consultar saldo da conta' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Saldo consultado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getBalance(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getBalance(accessToken);
  }

  @Post('ads/:adId/highlights')
  @ApiOperation({ summary: 'Aplicar destaque ao anúncio' })
  @ApiParam({ name: 'adId', description: 'ID do anúncio' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Destaque aplicado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async applyHighlight(
    @Headers('authorization') auth: string,
    @Param('adId') adId: string,
    @Body() body: { highlightType: string }
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.applyHighlight(accessToken, adId, body.highlightType);
  }

  @Delete('ads/:adId/highlights/:highlightId')
  @ApiOperation({ summary: 'Remover destaque do anúncio' })
  @ApiParam({ name: 'adId', description: 'ID do anúncio' })
  @ApiParam({ name: 'highlightId', description: 'ID do destaque' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Destaque removido com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async removeHighlight(
    @Headers('authorization') auth: string,
    @Param('adId') adId: string,
    @Param('highlightId') highlightId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.removeHighlight(accessToken, adId, highlightId);
  }

  @Post('ads/:adId/highlights/list')
  @ApiOperation({ summary: 'Listar destaques do anúncio' })
  @ApiParam({ name: 'adId', description: 'ID do anúncio' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Destaques listados com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getAdHighlights(
    @Headers('authorization') auth: string,
    @Param('adId') adId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getAdHighlights(accessToken, adId);
  }

  @Post('highlights/configurations')
  @ApiOperation({ summary: 'Consultar configurações de destaque' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Configurações consultadas com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async getHighlightConfigurations(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.getHighlightConfigurations(accessToken);
  }

  @Post('ads/:adId/renew')
  @ApiOperation({ summary: 'Renovar anúncio' })
  @ApiParam({ name: 'adId', description: 'ID do anúncio' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Anúncio renovado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async renewAd(
    @Headers('authorization') auth: string,
    @Param('adId') adId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.renewAd(accessToken, adId);
  }

  // ===== WEBHOOKS =====

  @Post('webhooks/configure')
  @ApiOperation({ summary: 'Configurar webhook da OLX' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Webhook configurado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async configureWebhook(
    @Headers('authorization') auth: string,
    @Body() body: { url: string; events: string[] }
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.configureWebhook(accessToken, body.url, body.events);
  }

  @Post('webhooks')
  @ApiOperation({ summary: 'Listar webhooks configurados' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Webhooks listados com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async listWebhooks(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.listWebhooks(accessToken);
  }

  @Delete('webhooks/:webhookId')
  @ApiOperation({ summary: 'Remover webhook' })
  @ApiParam({ name: 'webhookId', description: 'ID do webhook' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  @ApiResponse({ status: 200, description: 'Webhook removido com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async removeWebhook(
    @Headers('authorization') auth: string,
    @Param('webhookId') webhookId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.olxAdapter.removeWebhook(accessToken, webhookId);
  }

  @Post('webhooks/notification')
  @ApiOperation({ summary: 'Receber notificação de webhook da OLX' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async processWebhookNotification(@Body() payload: any) {
    return await this.olxAdapter.processWebhookNotification(payload);
  }

  @Get('health')
  @ApiOperation({ summary: 'Verificar status da integração OLX' })
  @ApiResponse({ status: 200, description: 'Status da integração' })
  async healthCheck() {
    return {
      marketplace: 'OLX',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  // ===== TEMPLATES DE DESCRIÇÃO =====

  @Get('templates')
  @ApiOperation({ summary: 'Listar templates de descrição da OLX' })
  @ApiResponse({ status: 200, description: 'Templates listados com sucesso' })
  async getTemplates() {
    return await this.descriptionService.findTemplatesByMarketplace('OLX');
  }

  @Get('templates/default')
  @ApiOperation({ summary: 'Obter template padrão da OLX' })
  @ApiResponse({ status: 200, description: 'Template padrão obtido com sucesso' })
  async getDefaultTemplate() {
    return await this.descriptionService.getDefaultTemplateForMarketplaceName('OLX');
  }

  @Post('templates')
  @ApiOperation({ summary: 'Criar novo template de descrição para OLX' })
  @ApiResponse({ status: 201, description: 'Template criado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async createTemplate(@Body() templateData: any) {
    const marketplace = await this.marketplaceService.findByName('OLX');

    if (!marketplace) {
      throw new BadRequestException('Marketplace OLX não encontrado');
    }

    return await this.descriptionService.createTemplate(
      templateData.name,
      templateData.title,
      templateData.template,
      marketplace._id,
      templateData.isDefault || false,
      templateData.placeholders,
      templateData.sections
    );
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Atualizar template de descrição da OLX' })
  @ApiParam({ name: 'id', description: 'ID do template' })
  @ApiResponse({ status: 200, description: 'Template atualizado com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 404, description: 'Template não encontrado' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() templateData: any
  ) {
    return await this.descriptionService.updateTemplate(id, templateData);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Excluir template de descrição da OLX' })
  @ApiParam({ name: 'id', description: 'ID do template' })
  @ApiResponse({ status: 200, description: 'Template excluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Template não encontrado' })
  async deleteTemplate(@Param('id') id: string) {
    return await this.descriptionService.deleteTemplate(id);
  }

  @Post('templates/generate')
  @ApiOperation({ summary: 'Gerar descrição usando template da OLX' })
  @ApiResponse({ status: 200, description: 'Descrição gerada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async generateDescription(@Body() data: { product: any; templateId?: number }) {
    return await this.descriptionService.generateDescription(
      data.product,
      'OLX',
      data.templateId ? String(data.templateId) : undefined
    );
  }

}