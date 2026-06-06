import { Controller, Get, Post, Body, Param, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MarketplaceTokenBrokerService } from '../services/marketplace-token-broker.service';
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
    private readonly broker: MarketplaceTokenBrokerService,
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

    const account = await this.broker.registerAccount({
      marketplaceId: marketplace._id.toString(),
      label: body.label,
      domains: body.domains,
      credentials: { clientId: body.clientId, clientSecret: body.clientSecret },
    });

    const { authUrl } = await this.broker.buildAuthUrl(account.accountId, this.callbackUri());
    return { accountId: account.accountId, label: account.label, domains: account.domains, authUrl };
  }

  // NOTA: o callback OAuth é atendido na RAIZ por MarketplaceCallbackController
  // (GET / com guarda code+state), porque a app ML tem a redirect registrada
  // como a raiz e o ML exige match exato. O accountId trafega no `state`.

  @Get(':accountId/auth/url')
  @ApiOperation({ summary: 'Gera a URL de autorização OAuth para a conta' })
  async authUrl(@Param('accountId') accountId: string): Promise<{ authUrl: string }> {
    return this.broker.buildAuthUrl(accountId, this.callbackUri());
  }

  /**
   * Redirect_uri FIXA — idêntica na autorização e na troca do code.
   * É a RAIZ porque a app ML tem a redirect registrada como a raiz e o ML
   * exige match exato. O callback é atendido por MarketplaceCallbackController
   * (GET / com guarda de code+state). O accountId trafega no `state`.
   */
  private callbackUri(): string {
    return this.config.get<string>('API_BASE_URL') ?? '';
  }
}
