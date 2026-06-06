import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { MarketplaceSignerService } from '../marketplace/auth/services/marketplace-signer.service';

/**
 * Assinatura de requests de marketplace para microserviços (orchestrator).
 * O segredo (partnerKey/appSecret/awsSecretKey) NUNCA é retornado — só a
 * assinatura/params/headers prontos. Protegido por x-internal-key.
 *
 * Usage: POST /internal/sign/shopee     { path, timestamp, accessToken, shopId }
 *        POST /internal/sign/tiktokshop { path, timestamp, accessToken, shopCipher, body }
 *        POST /internal/sign/amazon     { method, host, path, accessToken, body, region }
 */
@ApiTags('internal')
@Controller('internal/sign')
@UseGuards(InternalKeyGuard)
export class InternalSignController {
  constructor(private readonly signer: MarketplaceSignerService) {}

  @Post(':tag')
  @ApiOperation({ summary: 'Assina um request de marketplace no backend (segredo não sai)' })
  async sign(@Param('tag') tag: string, @Body() payload: Record<string, any>) {
    return this.signer.sign(tag, payload ?? {});
  }
}
