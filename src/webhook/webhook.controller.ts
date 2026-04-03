import { Controller, Post, Body, Param, Headers, Logger, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) { }

  @Post('mercadolivre/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações do Mercado Livre' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (orders, items, etc)' })
  @ApiHeader({ name: 'x-signature', description: 'Assinatura da notificação' })
  async handleMercadoLivreWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-signature') signature: string,
  ) {
    // this.logger.log(`Webhook recebido do Mercado Livre: ${topic}`);

    return this.webhookService.processMercadoLivreWebhook(topic, payload, signature);
  }

  @Post('mercadolivre')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações do Mercado Livre (Genérico)' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiHeader({ name: 'x-signature', description: 'Assinatura da notificação' })
  async handleMercadoLivreWebhookGeneric(
    @Body() payload: any,
    @Headers('x-signature') signature: string,
  ) {
    const topic = payload.topic || 'unknown';
    // this.logger.log(`Webhook genérico recebido do Mercado Livre: ${topic}`);

    return this.webhookService.processMercadoLivreWebhook(topic, payload, signature);
  }

  @Post('shopee/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da Shopee' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (order, product, etc)' })
  @ApiHeader({ name: 'x-shopee-signature', description: 'Assinatura da notificação' })
  async handleShopeeWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-shopee-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido da Shopee: ${topic}`);

    return this.webhookService.processShopeeWebhook(topic, payload, signature);
  }

  @Post('amazon/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da Amazon' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (order-notification, etc)' })
  @ApiHeader({ name: 'x-amz-sns-message-type', description: 'Tipo de mensagem SNS' })
  async handleAmazonWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-amz-sns-message-type') messageType: string,
  ) {
    this.logger.log(`Webhook recebido da Amazon: ${topic}, tipo: ${messageType}`);

    return this.webhookService.processAmazonWebhook(topic, payload, messageType);
  }

  @Post('magalu/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da Magazine Luiza' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (orders, products, etc)' })
  @ApiHeader({ name: 'x-magalu-signature', description: 'Assinatura da notificação' })
  async handleMagaluWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-magalu-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido da Magazine Luiza: ${topic}`);

    return this.webhookService.processMagaluWebhook(topic, payload, signature);
  }

  @Post('b2w/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da B2W (Americanas, Submarino, Shoptime)' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (orders, skus, etc)' })
  @ApiHeader({ name: 'x-hub-signature', description: 'Assinatura da notificação' })
  async handleB2WWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-hub-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido da B2W: ${topic}`);

    return this.webhookService.processB2WWebhook(topic, payload, signature);
  }

  @Post('viavarejo/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da Via Varejo (Casas Bahia, Ponto Frio)' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (orders, products, etc)' })
  @ApiHeader({ name: 'x-viavarejo-signature', description: 'Assinatura da notificação' })
  async handleViaVarejoWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-viavarejo-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido da Via Varejo: ${topic}`);

    return this.webhookService.processViaVarejoWebhook(topic, payload, signature);
  }

  @Post('yampi/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da Yampi' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (order, product, etc)' })
  @ApiHeader({ name: 'x-yampi-hmac-sha256', description: 'Assinatura da notificação' })
  async handleYampiWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-yampi-hmac-sha256') signature: string,
  ) {
    this.logger.log(`Webhook recebido da Yampi: ${topic}`);

    return this.webhookService.processYampiWebhook(topic, payload, signature);
  }

  @Post('olx/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da OLX' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (lead, etc)' })
  async handleOLXWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
  ) {
    this.logger.log(`Webhook recebido da OLX: ${topic}`);

    return this.webhookService.processOLXWebhook(topic, payload);
  }

  @Post('aliexpress/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações da AliExpress' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (logistics, trade, etc)' })
  @ApiHeader({ name: 'x-acs-signature', description: 'Assinatura da notificação' })
  async handleAliExpressWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-acs-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido da AliExpress: ${topic}`);

    return this.webhookService.processAliExpressWebhook(topic, payload, signature);
  }

  @Post('tiktokshop/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber notificações do TikTok Shop' })
  @ApiResponse({ status: 200, description: 'Notificação processada com sucesso' })
  @ApiParam({ name: 'topic', description: 'Tópico da notificação (order, product, etc)' })
  @ApiHeader({ name: 'x-tts-signature', description: 'Assinatura da notificação' })
  async handleTikTokShopWebhook(
    @Param('topic') topic: string,
    @Body() payload: any,
    @Headers('x-tts-signature') signature: string,
  ) {
    this.logger.log(`Webhook recebido do TikTok Shop: ${topic}`);

    return this.webhookService.processTikTokShopWebhook(topic, payload, signature);
  }
}
