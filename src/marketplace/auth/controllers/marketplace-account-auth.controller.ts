import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MarketplaceAccountService } from '../services/marketplace-account.service';

/**
 * Fluxo OAuth POR CONTA (multi-client). Caminho PARALELO ao callback de
 * autopeças (`/auth/:tag/callback`), que NÃO é tocado. Controller fino —
 * toda a lógica vive no MarketplaceAccountService.
 */
@ApiTags('marketplace-account-auth')
@Controller('marketplace-account')
export class MarketplaceAccountAuthController {
  constructor(
    private readonly accountService: MarketplaceAccountService,
    private readonly config: ConfigService,
  ) {}

  @Get(':accountId/auth/url')
  @ApiOperation({ summary: 'Gera a URL de autorização OAuth para a conta' })
  async authUrl(@Param('accountId') accountId: string): Promise<{ authUrl: string }> {
    return this.accountService.buildAuthUrl(accountId, this.callbackUri(accountId));
  }

  @Get(':accountId/auth/callback')
  @ApiOperation({ summary: 'Callback OAuth da conta — troca code por token e persiste' })
  async callback(
    @Param('accountId') accountId: string,
    @Query('code') code: string,
  ): Promise<{ ok: true }> {
    if (!code) throw new BadRequestException('Código de autorização não fornecido.');
    await this.accountService.handleAuthCallback(accountId, code, this.callbackUri(accountId));
    return { ok: true };
  }

  private callbackUri(accountId: string): string {
    const base = this.config.get<string>('API_BASE_URL') ?? '';
    return `${base}/marketplace-account/${accountId}/auth/callback`;
  }
}
