import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import { WebhookIngressGuard } from './ingress/webhook-ingress.guard';
import { WebhookIngressService } from './ingress/webhook-ingress.service';
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly ingress: WebhookIngressService) {}
  @Post(':marketplace/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookIngressGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber webhook de marketplace (genérico)' })
  @ApiParam({ name: 'marketplace' })
  @ApiParam({ name: 'topic' })
  @ApiResponse({ status: 200 })
  async handle(@Param('marketplace') _m: string, @Param('topic') _t: string, @Req() req: any) {
    return this.ingress.ingest(req.webhookAdapter, req.webhookContext);
  }
  @Post(':marketplace')
  @SkipJwtAuth()
  @UseGuards(WebhookIngressGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber webhook sem topic na rota (ML genérico)' })
  @ApiParam({ name: 'marketplace' })
  @ApiResponse({ status: 200 })
  async handleNoTopic(@Param('marketplace') _m: string, @Req() req: any) {
    return this.ingress.ingest(req.webhookAdapter, req.webhookContext);
  }
}
