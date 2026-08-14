import { Controller, Get, Post, Put, Delete, Body, Param, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MarketplaceTokenBrokerService } from '../services/marketplace-token-broker.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';

interface RegisterAccountBody {
  label: string;
  clientId: string;
  clientSecret: string;
}

/** Conta ativa de publicação. `accountId: null` = desligar (não publicar). */
interface SetActiveAccountBody {
  accountId: string | null;
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
   *   body: { label, clientId, clientSecret }
   */
  @Post(':tag')
  @ApiOperation({ summary: 'Cria uma conta de marketplace (multi-client)' })
  async createAccount(
    @Param('tag') tag: string,
    @Body() body: RegisterAccountBody,
  ): Promise<{ accountId: string; label: string; authUrl: string }> {
    if (!body?.label?.trim()) throw new BadRequestException('label é obrigatório.');
    if (!body?.clientId?.trim() || !body?.clientSecret?.trim()) {
      throw new BadRequestException('clientId e clientSecret são obrigatórios.');
    }

    const marketplace = await this.registry.findByTag(tag);
    if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);

    const account = await this.broker.registerAccount({
      marketplaceId: marketplace._id.toString(),
      label: body.label,
      credentials: { clientId: body.clientId, clientSecret: body.clientSecret },
    });

    const { authUrl } = await this.broker.buildAuthUrl(account.accountId, this.callbackUri());
    return { accountId: account.accountId, label: account.label, authUrl };
  }

  /**
   * Lista as contas multi-client de um marketplace + a conta ATIVA atual.
   * Não expõe secret nem accessToken — só nome real, status do token e qual é a ativa.
   *
   * Usage: GET /marketplace-account/mercadolivre
   */
  @Get(':tag')
  @ApiOperation({ summary: 'Lista contas (multi-client) e a conta ativa de um marketplace' })
  async listAccounts(@Param('tag') tag: string) {
    const marketplace = await this.registry.findByTag(tag);
    if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);
    return this.broker.listAccounts(marketplace._id.toString());
  }

  /**
   * Define a conta ATIVA de publicação. Body: { accountId: id | null }.
   * `null` desliga a publicação (nenhuma conta ativa).
   *
   * Usage: PUT /marketplace-account/mercadolivre/active-account
   */
  @Put(':tag/active-account')
  @ApiOperation({ summary: 'Define a conta ativa de publicação (radio da tela)' })
  async setActiveAccount(@Param('tag') tag: string, @Body() body: SetActiveAccountBody) {
    if (!body || !('accountId' in body)) {
      throw new BadRequestException('accountId é obrigatório (use null para desligar).');
    }
    const marketplace = await this.registry.findByTag(tag);
    if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);
    return this.broker.setActiveAccount(marketplace._id.toString(), body.accountId);
  }

  /**
   * Remove uma conta multi-client. Se era a conta ativa, limpa a ativação.
   *
   * Usage: DELETE /marketplace-account/mercadolivre/:accountId
   */
  @Delete(':tag/:accountId')
  @ApiOperation({ summary: 'Remove uma conta multi-client de um marketplace' })
  async deleteAccount(@Param('tag') tag: string, @Param('accountId') accountId: string) {
    const marketplace = await this.registry.findByTag(tag);
    if (!marketplace) throw new NotFoundException(`Marketplace not found: ${tag}`);
    await this.broker.deleteAccount(marketplace._id.toString(), accountId);
    return { deleted: true };
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
   * Atualiza o nome real da conta (re-busca o perfil no marketplace). Backfill
   * para contas autorizadas antes desta feature.
   *
   * Usage: POST /marketplace-account/:accountId/refresh-profile
   */
  @Post(':accountId/refresh-profile')
  @ApiOperation({ summary: 'Re-busca o nome real da conta no marketplace' })
  async refreshProfile(@Param('accountId') accountId: string): Promise<{ nickname: string | null }> {
    return this.broker.refreshAccountProfile(accountId);
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
