import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TikTokShopService } from '../services/tiktok-shop.service';

@ApiTags('tiktok-shop')
@Controller('marketplace/tiktok-shop')
export class TikTokShopController {
  private readonly logger = new Logger(TikTokShopController.name);

  constructor(private readonly tiktokShopService: TikTokShopService) {}

  @Get('auth/url')
  @ApiOperation({ summary: 'Gerar URL de autorização do TikTok Shop' })
  @ApiResponse({ status: 200, description: 'URL gerada com sucesso' })
  @ApiQuery({ name: 'redirectUri', required: false })
  async getAuthUrl(@Query('redirectUri') redirectUri?: string) {
    return this.tiktokShopService.generateAuthUrl(redirectUri);
  }

  @Post('auth/token')
  @ApiOperation({ summary: 'Trocar código de autorização por token' })
  @ApiResponse({ status: 201, description: 'Token obtido com sucesso' })
  async authenticate(@Body() body: { code: string; additionalData?: any }) {
    return this.tiktokShopService.authenticate(body.code, body.additionalData);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorias do TikTok Shop' })
  @ApiResponse({ status: 200, description: 'Lista de categorias' })
  @ApiQuery({ name: 'locale', required: false })
  async getCategories(@Query('locale') locale?: string) {
    return this.tiktokShopService.getCategories(locale);
  }

  @Get('categories/:categoryId/attributes')
  @ApiOperation({ summary: 'Buscar atributos de uma categoria' })
  @ApiResponse({ status: 200, description: 'Atributos da categoria' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiQuery({ name: 'locale', required: false })
  async getCategoryAttributes(
    @Param('categoryId') categoryId: string,
    @Query('locale') locale?: string,
  ) {
    return this.tiktokShopService.getCategoryAttributes(categoryId, locale);
  }

  @Get('categories/:categoryId/rules')
  @ApiOperation({ summary: 'Buscar regras de uma categoria' })
  @ApiResponse({ status: 200, description: 'Regras da categoria' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  async getCategoryRules(@Param('categoryId') categoryId: string) {
    return this.tiktokShopService.getCategoryRules(categoryId);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Listar pedidos do TikTok Shop' })
  @ApiResponse({ status: 200, description: 'Lista de pedidos' })
  async getOrders(@Query() params: any) {
    return this.tiktokShopService.getOrders(params);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Buscar detalhes de um pedido' })
  @ApiResponse({ status: 200, description: 'Detalhes do pedido' })
  @ApiParam({ name: 'orderId', description: 'ID do pedido no TikTok Shop' })
  async getOrderDetails(@Param('orderId') orderId: string) {
    return this.tiktokShopService.getOrderDetails(orderId);
  }

  @Put('orders/:orderId/status')
  @ApiOperation({ summary: 'Atualizar status de um pedido' })
  @ApiResponse({ status: 200, description: 'Status atualizado' })
  @ApiParam({ name: 'orderId', description: 'ID do pedido' })
  async updateOrderStatus(
    @Param('orderId') orderId: string,
    @Body() body: { status: string },
  ) {
    return this.tiktokShopService.updateOrderStatus(orderId, body.status);
  }
}
