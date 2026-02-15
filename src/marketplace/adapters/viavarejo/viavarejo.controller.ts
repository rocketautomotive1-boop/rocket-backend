import { Controller, Post, Get, Put, Delete, Body, Param, Query, Headers, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { ViaVarejoAdapter } from './viavarejo.adapter';
import { ViaVarejoAuthAdapter } from './viavarejo-auth.adapter';
import { ViaVarejoProductAdapter } from './viavarejo-product.adapter';
import { ViaVarejoOrderAdapter } from './viavarejo-order.adapter';
import { ViaVarejoCategoryAdapter } from './viavarejo-category.adapter';

@ApiTags('Via Varejo Marketplace')
@Controller('marketplace/viavarejo')
export class ViaVarejoController {
  constructor(
    private readonly viaVarejoAdapter: ViaVarejoAdapter,
    private readonly authAdapter: ViaVarejoAuthAdapter,
    private readonly productAdapter: ViaVarejoProductAdapter,
    private readonly orderAdapter: ViaVarejoOrderAdapter,
    private readonly categoryAdapter: ViaVarejoCategoryAdapter
  ) {}

  // Helper method to extract and validate token
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

  @Post('auth/authenticate')
  @ApiOperation({ summary: 'Autenticar na Via Varejo' })
  @ApiResponse({ status: 200, description: 'Autenticação realizada com sucesso' })
  @ApiResponse({ status: 400, description: 'Credenciais inválidas' })
  async authenticate(@Body() credentials: {
    clientId: string;
    clientSecret: string;
    sellerId: string;
    marketplaceId: number;
  }) {
    return await this.authAdapter.authenticate(credentials);
  }

  @Post('auth/refresh')
  @ApiOperation({ summary: 'Renovar token da Via Varejo' })
  @ApiResponse({ status: 200, description: 'Token renovado com sucesso' })
  async refreshToken(@Body() tokenData: any) {
    return await this.authAdapter.refreshToken(tokenData);
  }

  @Post('auth/validate')
  @ApiOperation({ summary: 'Validar token da Via Varejo' })
  @ApiResponse({ status: 200, description: 'Token válido' })
  async validateToken(@Body() tokenData: any) {
    return await this.authAdapter.validateToken(tokenData);
  }

  // ===== PRODUTOS =====

  @Post('products')
  @ApiOperation({ summary: 'Criar produto na Via Varejo' })
  @ApiResponse({ status: 201, description: 'Produto criado com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async createProduct(@Headers('authorization') auth: string, @Body() product: any) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const productWithToken = { ...product, token: accessToken, sellerId };
    return await this.productAdapter.createProduct(productWithToken);
  }

  @Put('products/:externalId')
  @ApiOperation({ summary: 'Atualizar produto na Via Varejo' })
  @ApiResponse({ status: 200, description: 'Produto atualizado com sucesso' })
  @ApiParam({ name: 'externalId', description: 'ID externo do produto' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateProduct(
    @Headers('authorization') auth: string,
    @Param('externalId') externalId: string,
    @Body() product: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const productWithToken = { ...product, token: accessToken, sellerId };
    return await this.productAdapter.updateProduct(externalId, productWithToken);
  }

  @Put('products/:externalId/images')
  @ApiOperation({ summary: 'Atualizar imagens do produto' })
  @ApiResponse({ status: 200, description: 'Imagens atualizadas com sucesso' })
  @ApiParam({ name: 'externalId', description: 'ID externo do produto' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateProductImages(
    @Headers('authorization') auth: string,
    @Param('externalId') externalId: string,
    @Body() imageData: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const dataWithToken = { ...imageData, token: accessToken, sellerId };
    return await this.productAdapter.updateProductImages(externalId, dataWithToken);
  }

  @Put('products/:externalId/title')
  @ApiOperation({ summary: 'Atualizar título do produto' })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso' })
  @ApiParam({ name: 'externalId', description: 'ID externo do produto' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateProductTitle(
    @Headers('authorization') auth: string,
    @Param('externalId') externalId: string,
    @Body() titleData: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const dataWithToken = { ...titleData, token: accessToken, sellerId };
    return await this.productAdapter.updateProductTitle(externalId, dataWithToken);
  }

  @Put('products/:externalId/category')
  @ApiOperation({ summary: 'Atualizar categoria do produto' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  @ApiParam({ name: 'externalId', description: 'ID externo do produto' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateProductCategory(
    @Headers('authorization') auth: string,
    @Param('externalId') externalId: string,
    @Body() categoryData: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const dataWithToken = { ...categoryData, token: accessToken, sellerId };
    return await this.productAdapter.updateProductCategory(externalId, dataWithToken);
  }

  @Put('products/:externalId/inventory')
  @ApiOperation({ summary: 'Atualizar inventário do produto' })
  @ApiResponse({ status: 200, description: 'Inventário atualizado com sucesso' })
  @ApiParam({ name: 'externalId', description: 'ID externo do produto' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateProductInventory(
    @Headers('authorization') auth: string,
    @Param('externalId') externalId: string,
    @Body() inventoryData: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const dataWithToken = { ...inventoryData, token: accessToken, sellerId };
    return await this.productAdapter.updateProductInventory(externalId, dataWithToken);
  }

  @Post('products/validate')
  @ApiOperation({ summary: 'Validar produto para Via Varejo' })
  @ApiResponse({ status: 200, description: 'Validação realizada com sucesso' })
  async validateProduct(@Body() product: any) {
    return await this.productAdapter.validateProduct(product);
  }

  // ===== PEDIDOS =====

  @Get('orders')
  @ApiOperation({ summary: 'Listar pedidos da Via Varejo' })
  @ApiResponse({ status: 200, description: 'Pedidos retornados com sucesso' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limite de resultados' })
  @ApiQuery({ name: 'page', required: false, description: 'Página' })
  @ApiQuery({ name: 'status', required: false, description: 'Status do pedido' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getOrders(
    @Headers('authorization') auth: string,
    @Query() params: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const paramsWithToken = { ...params, token: accessToken, sellerId };
    return await this.orderAdapter.getOrders(paramsWithToken);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Obter detalhes do pedido' })
  @ApiResponse({ status: 200, description: 'Detalhes do pedido retornados com sucesso' })
  @ApiParam({ name: 'orderId', description: 'ID do pedido' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getOrderDetails(
    @Headers('authorization') auth: string,
    @Param('orderId') orderId: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const orderData = { token: accessToken, orderId, sellerId };
    return await this.orderAdapter.getOrderDetails(orderData);
  }

  @Put('orders/:orderId/status')
  @ApiOperation({ summary: 'Atualizar status do pedido' })
  @ApiResponse({ status: 200, description: 'Status atualizado com sucesso' })
  @ApiParam({ name: 'orderId', description: 'ID do pedido' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateOrderStatus(
    @Headers('authorization') auth: string,
    @Param('orderId') orderId: string,
    @Body() statusData: { status: string }
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const orderData = { token: accessToken, orderId, sellerId };
    return await this.orderAdapter.updateOrderStatus(orderData, statusData.status);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Criar pedido na Via Varejo' })
  @ApiResponse({ status: 201, description: 'Pedido criado com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async createOrder(@Headers('authorization') auth: string, @Body() order: any) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const orderWithToken = { ...order, token: accessToken, sellerId };
    return await this.orderAdapter.createOrder(orderWithToken);
  }

  @Get('orders/statuses')
  @ApiOperation({ summary: 'Obter status disponíveis para pedidos' })
  @ApiResponse({ status: 200, description: 'Status retornados com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getOrderStatuses(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.orderAdapter.getOrderStatuses(sellerId, accessToken);
  }

  @Get('orders/:orderId/tracking')
  @ApiOperation({ summary: 'Obter rastreamento do pedido' })
  @ApiResponse({ status: 200, description: 'Rastreamento retornado com sucesso' })
  @ApiParam({ name: 'orderId', description: 'ID do pedido' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getOrderTracking(
    @Headers('authorization') auth: string,
    @Param('orderId') orderId: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.orderAdapter.getOrderTracking(orderId, sellerId, accessToken);
  }

  // ===== CATEGORIAS =====

  @Get('categories')
  @ApiOperation({ summary: 'Listar categorias da Via Varejo' })
  @ApiResponse({ status: 200, description: 'Categorias retornadas com sucesso' })
  @ApiQuery({ name: 'parentId', required: false, description: 'ID da categoria pai' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getCategories(
    @Headers('authorization') auth: string,
    @Query('parentId') parentId?: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.categoryAdapter.getCategories(accessToken, sellerId, parentId);
  }

  @Get('categories/:categoryId')
  @ApiOperation({ summary: 'Obter categoria específica' })
  @ApiResponse({ status: 200, description: 'Categoria retornada com sucesso' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getCategoryById(
    @Headers('authorization') auth: string,
    @Param('categoryId') categoryId: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.categoryAdapter.getCategoryById(categoryId, accessToken, sellerId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Criar categoria na Via Varejo' })
  @ApiResponse({ status: 201, description: 'Categoria criada com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async createCategory(@Headers('authorization') auth: string, @Body() category: any) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const categoryWithToken = { ...category, token: accessToken, sellerId };
    return await this.categoryAdapter.createCategory(categoryWithToken);
  }

  @Put('categories/:categoryId')
  @ApiOperation({ summary: 'Atualizar categoria na Via Varejo' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateCategory(
    @Headers('authorization') auth: string,
    @Param('categoryId') categoryId: string,
    @Body() category: any
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    const categoryWithToken = { ...category, token: accessToken, sellerId };
    return await this.categoryAdapter.updateCategory(categoryId, categoryWithToken);
  }

  @Delete('categories/:categoryId')
  @ApiOperation({ summary: 'Excluir categoria na Via Varejo' })
  @ApiResponse({ status: 200, description: 'Categoria excluída com sucesso' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async deleteCategory(
    @Headers('authorization') auth: string,
    @Param('categoryId') categoryId: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.categoryAdapter.deleteCategory(categoryId, accessToken, sellerId);
  }

  @Get('categories/:categoryId/attributes')
  @ApiOperation({ summary: 'Obter atributos da categoria' })
  @ApiResponse({ status: 200, description: 'Atributos retornados com sucesso' })
  @ApiParam({ name: 'categoryId', description: 'ID da categoria' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getCategoryAttributes(
    @Headers('authorization') auth: string,
    @Param('categoryId') categoryId: string
  ) {
    const accessToken = this.extractToken(auth);
    const sellerId = this.extractSellerIdFromToken(accessToken) || 'default_seller_id';
    return await this.categoryAdapter.getCategoryAttributes(categoryId, accessToken, sellerId);
  }

  // ===== WEBHOOKS =====

  @Post('webhooks/configure')
  @ApiOperation({ summary: 'Configurar webhook da Via Varejo' })
  @ApiResponse({ status: 200, description: 'Webhook configurado com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async configureWebhook(
    @Headers('authorization') auth: string,
    @Body() webhookData: { url: string; events?: string[] }
  ) {
    const accessToken = this.extractToken(auth);
    return await this.viaVarejoAdapter.configureWebhook(accessToken, webhookData);
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Listar webhooks configurados' })
  @ApiResponse({ status: 200, description: 'Webhooks retornados com sucesso' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async listWebhooks(@Headers('authorization') auth: string) {
    const accessToken = this.extractToken(auth);
    return await this.viaVarejoAdapter.listWebhooks(accessToken);
  }

  @Delete('webhooks/:webhookId')
  @ApiOperation({ summary: 'Remover webhook' })
  @ApiResponse({ status: 200, description: 'Webhook removido com sucesso' })
  @ApiParam({ name: 'webhookId', description: 'ID do webhook' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async removeWebhook(
    @Headers('authorization') auth: string,
    @Param('webhookId') webhookId: string
  ) {
    const accessToken = this.extractToken(auth);
    return await this.viaVarejoAdapter.removeWebhook(accessToken, webhookId);
  }

  // ===== UTILITÁRIOS =====

  @Post('products/check-requirements')
  @ApiOperation({ summary: 'Verificar requisitos mínimos do produto' })
  @ApiResponse({ status: 200, description: 'Verificação realizada com sucesso' })
  async checkProductRequirements(@Body() product: any) {
    return await this.productAdapter.validateProduct(product);
  }

  @Get('health')
  @ApiOperation({ summary: 'Verificar saúde da integração' })
  @ApiResponse({ status: 200, description: 'Integração funcionando normalmente' })
  async healthCheck() {
    return {
      status: 'healthy',
      marketplace: 'Via Varejo',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  // Helper method to extract sellerId from token
  private extractSellerIdFromToken(token: string): string | null {
    try {
      // Em uma implementação real, você decodificaria o JWT token
      // Por enquanto, retornamos null para usar o valor padrão
      return null;
    } catch (error) {
      return null;
    }
  }
} 