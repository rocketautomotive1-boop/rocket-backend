import { Controller, Get, Put, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { GroupService } from './services/group.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

interface SetGroupAccountBody {
  accountId: string;
}

/**
 * CRUD mínimo (leitura + edição de mapeamento) sobre GroupModel — criação/
 * remoção de grupo continua fora de escopo (cardinalidade baixa e fixa, ver
 * docs/superpowers/specs/2026-08-10-multi-account-publishing-by-group-design.md).
 * Admin-only: decide o roteamento de publicação por loja.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('groups')
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  /**
   * Lista os grupos com o mapeamento marketplaceTag→conta já resolvido para
   * label legível (busca nome real da conta em MarketplaceModel.accounts[]).
   */
  @Get()
  async list() {
    const [groups, marketplaces] = await Promise.all([
      this.groupService.findAll(),
      this.configCache.getAll(),
    ]);

    const accountLabelByTagAndId = new Map<string, string>();
    for (const mp of marketplaces) {
      for (const acc of (mp as any).accounts ?? []) {
        accountLabelByTagAndId.set(`${mp.tag}:${String(acc._id)}`, acc.label);
      }
    }

    return groups.map((g) => ({
      groupId: g.id,
      name: g.name,
      accounts: Object.entries(g.accounts ?? {}).map(([marketplaceTag, accountId]) => ({
        marketplaceTag,
        accountId,
        accountLabel: accountLabelByTagAndId.get(`${marketplaceTag}:${accountId}`) ?? null,
      })),
    }));
  }

  /**
   * Contas disponíveis por marketplace (para popular o seletor da tela).
   */
  @Get('marketplace-accounts')
  async listMarketplaceAccounts() {
    const marketplaces = await this.configCache.getAll();
    return marketplaces
      .filter((mp) => !!mp.tag)
      .map((mp) => ({
        marketplaceTag: mp.tag,
        marketplaceName: mp.name,
        accounts: ((mp as any).accounts ?? []).map((acc: any) => ({
          accountId: String(acc._id),
          label: acc.label,
        })),
      }));
  }

  @Put(':groupId/accounts/:marketplaceTag')
  async setMarketplaceAccount(
    @Param('groupId') groupId: string,
    @Param('marketplaceTag') marketplaceTag: string,
    @Body() body: SetGroupAccountBody,
  ) {
    if (!body?.accountId?.trim()) throw new BadRequestException('accountId é obrigatório.');
    await this.groupService.setMarketplaceAccount(groupId, marketplaceTag, body.accountId.trim());
    return { updated: true };
  }
}
