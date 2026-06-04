import { Controller, Get, Post, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MarketplaceAccountService } from '../services/marketplace-account.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';

interface RegisterAccountBody {
  label: string;
  domains: string[];
  clientId: string;
  clientSecret: string;
}

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
    private readonly registry: MarketplaceRegistryService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cria uma conta de marketplace para o(s) domínio(s) informado(s) (multi-client).
   * Ex.: cadastrar a conta ML que atende `domain:'general'`. Após criar, use o
   * `authUrl` retornado para autorizar a conta via OAuth e popular o token.
   *
   * Usage: POST /marketplace-account/mercadolivre
   *   body: { label, domains: ['general'], clientId, clientSecret }
   */
  @Post(':tag')
  @ApiOperation({ summary: 'Cria uma conta de marketplace (multi-client) para um domínio' })
  async createAccount(
    @Param('tag') tag: string,
    @Body() body: RegisterAccountBody,
  ): Promise<{ accountId: string; label: string; domains: string[]; authUrl: string }> {
    if (!body?.label?.trim()) throw new BadRequestException('label é obrigatório.');
    if (!body?.domains?.length) throw new BadRequestException('domains é obrigatório.');
    if (!body?.clientId?.trim() || !body?.clientSecret?.trim()) {
      throw new BadRequestException('clientId e clientSecret são obrigatórios.');
    }

    const marketplace = await this.registry.findByTag(tag);
    if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

    const account = await this.accountService.registerAccount({
      marketplaceId: marketplace._id.toString(),
      label: body.label,
      domains: body.domains,
      credentials: { clientId: body.clientId, clientSecret: body.clientSecret },
    });

    const accountId = String((account as any)._id);
    const { authUrl } = await this.accountService.buildAuthUrl(accountId, this.callbackUri(accountId));
    return { accountId, label: account.label, domains: account.domains, authUrl };
  }

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
