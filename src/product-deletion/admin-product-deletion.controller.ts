import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProductDeletionService } from './product-deletion.service';
import { ListingService } from '../listing/listing.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';

/**
 * Exclusão completa de produto (marketplace + Listing + Product) — painel de administração
 * (admin/). Admin-only: é uma operação destrutiva com efeito colateral em marketplaces
 * externos. Ver docs/superpowers/specs/2026-09-04-admin-product-deletion-design.md.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/products')
export class AdminProductDeletionController {
  constructor(
    private readonly deletionService: ProductDeletionService,
    private readonly listingService: ListingService,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  /** Leitura prévia (sem side-effect) dos marketplaces afetados — usada pelo modal de confirmação. */
  @Get(':id/deletion-preview')
  async preview(@Param('id') id: string) {
    const listings = await this.listingService.findByProduct(id);
    const marketplaces = await Promise.all(
      listings.map(async (l) => {
        const config = await this.configCache.getById(String(l.marketplaceId));
        return {
          marketplaceName: config?.name ?? String(l.marketplaceId),
          published: !!l.externalId,
        };
      }),
    );
    return { marketplaces };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    const requesterId = req?.user?.id ?? req?.user?.sub;
    return this.deletionService.requestDeletion(id, requesterId);
  }

  @Get(':id/deletion-status')
  async status(@Param('id') id: string) {
    return this.deletionService.getDeletionStatus(id);
  }
}
