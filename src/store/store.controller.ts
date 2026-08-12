import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { StoreService } from './services/store.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

interface SetStoreAccountBody {
  accountId: string;
}

interface CreateStoreBody {
  name: string;
}

/**
 * CRUD de lojas — painel de administração (admin/). Admin-only: decide o
 * roteamento de publicação por loja.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('stores')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  /**
   * Lista as lojas com o mapeamento marketplaceTag→conta já resolvido para
   * label legível (busca nome real da conta em MarketplaceModel.accounts[]).
   */
  @Get()
  async list() {
    const [stores, marketplaces] = await Promise.all([
      this.storeService.findAll(),
      this.configCache.getAll(),
    ]);

    const accountLabelByTagAndId = new Map<string, string>();
    for (const mp of marketplaces) {
      for (const acc of (mp as any).accounts ?? []) {
        accountLabelByTagAndId.set(`${mp.tag}:${String(acc._id)}`, acc.label);
      }
    }

    return stores.map((s) => ({
      storeId: s.id,
      name: s.name,
      accounts: Object.entries(s.accounts ?? {}).map(([marketplaceTag, accountId]) => ({
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

  @Post()
  async create(@Body() body: CreateStoreBody) {
    const store = await this.storeService.create(body?.name);
    return { storeId: store.id, name: store.name };
  }

  @Put(':storeId/accounts/:marketplaceTag')
  async setMarketplaceAccount(
    @Param('storeId') storeId: string,
    @Param('marketplaceTag') marketplaceTag: string,
    @Body() body: SetStoreAccountBody,
  ) {
    if (!body?.accountId?.trim()) throw new BadRequestException('accountId é obrigatório.');
    await this.storeService.setMarketplaceAccount(storeId, marketplaceTag, body.accountId.trim());
    return { updated: true };
  }

  @Delete(':storeId/accounts/:marketplaceTag')
  async removeMarketplaceAccount(
    @Param('storeId') storeId: string,
    @Param('marketplaceTag') marketplaceTag: string,
  ) {
    await this.storeService.removeMarketplaceAccount(storeId, marketplaceTag);
    return { updated: true };
  }
}
