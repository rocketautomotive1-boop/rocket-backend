import { Injectable, Inject, forwardRef, Logger, BadRequestException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { ListingService } from '../../listing/listing.service';
import { ListingDocument } from '../../listing/schemas/listing.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface PromiseFulfilledResult<T> {
  status: 'fulfilled';
  value: T;
}

@Injectable()
export class MarketplaceIntegrationService {
  private readonly logger = new Logger(MarketplaceIntegrationService.name);

  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly registryService: MarketplaceRegistryService,
    private readonly adapterRegistry: MarketplaceAdapterRegistry,
    private readonly listingService: ListingService,
    @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
  ) { }

  // --- READ METHODS (Migrated from MarketplacePublicationService) ---

  async getAllListings(
    params?: { status?: string; limit?: number; offset?: number; marketplaceId?: number | string; search?: string }
  ): Promise<any[]> {
    let marketplaces = await this.registryService.findAll();
    if (params?.marketplaceId) {
      marketplaces = marketplaces.filter(m => String(m.id || m._id) === String(params.marketplaceId));
    }

    const results = await Promise.allSettled(
      marketplaces.map(async (marketplace) => {
        try {
          const adapter = this.adapterRegistry.getProductAdapter(marketplace.name);
          if (adapter.getListings) {
            return await adapter.getListings({
              ...params,
              marketplaceId: marketplace._id
            });
          }
          return [];
        } catch (error) {
          return [];
        }
      })
    );

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any[]>).value)
      .flat()
      .sort((a, b) => {
        if (a.date_created && b.date_created) {
          return new Date(b.date_created).getTime() - new Date(a.date_created).getTime();
        }
        return 0;
      });
  }

  async getListing(marketplaceId: string): Promise<any> {
    const marketplace = await this.registryService.findOne(marketplaceId);
    if (!marketplace) throw new BadRequestException(`Marketplace ID ${marketplaceId} não encontrado`);
    const adapter = this.adapterRegistry.getProductAdapter(marketplace.name);
    if (adapter.getListings) {
      return await adapter.getListings({ marketplaceId: marketplace._id });
    }
    throw new BadRequestException(`Busca de lista não implementada para ${marketplace.name}.`);
  }

  async getListingsById(marketplaceId: string, marketplaceIds: string): Promise<any> {
    const marketplace = await this.registryService.findOne(marketplaceId);
    if (!marketplace) throw new BadRequestException(`Marketplace ID ${marketplaceId} não encontrado`);
    const adapter = this.adapterRegistry.getProductAdapter(marketplace.name);
    if (adapter.getListingDetail) {
      const ids = marketplaceIds.split(',');
      return await Promise.all(ids.map(id => adapter.getListingDetail(id)));
    }
    throw new BadRequestException(`Busca de lista por ID não implementada para ${marketplace.name}.`);
  }

  async getListingsStatus(productIds: number[]): Promise<any> {
    // [REF] Fetch products to get _ids
    const products = await this.productModel.find({
      sku: { $in: productIds }
    }).select('_id sku').lean().exec();

    const pIds = products.map(p => p._id);

    // Fetch all listings for these products
    const allListings = await this.listingService.listingModel.find({
      productId: { $in: pIds },
      externalId: { $ne: null }
    }).lean().exec() as unknown as ListingDocument[];

    const titles = allListings.map(l => ({
      ...l,
      productId: products.find(p => String(p._id) === String(l.productId))?.sku
    }));

    if (!titles.length) return {};

    const mlMarketplace = await this.registryService.findByName('Mercado Livre');
    const adapter = this.adapterRegistry.getProductAdapter('Mercado Livre');

    if (!mlMarketplace || !adapter.getListingDetail) return {};

    const externalIds = [...new Set(titles.map(pt => pt.externalId))];

    const listings = await Promise.all(externalIds.map(id => adapter.getListingDetail(id)));

    const statusMap: Record<number, any> = {};
    titles.forEach(productTitle => {
      const listing = listings.find((l: any) => (l.id || l.body?.id) === productTitle.externalId);
      if (listing) {
        const body = listing.body || listing;
        if (body && body.id) {
          statusMap[productTitle.productId] = {
            externalId: body.id,
            title: body.title,
            price: body.price,
            availableQuantity: body.available_quantity,
            soldQuantity: body.sold_quantity,
            status: body.status,
            condition: body.condition,
            permalink: body.permalink,
            thumbnail: body.thumbnail,
            dateCreated: body.date_created,
            lastUpdated: body.last_updated,
            marketplace: 'Mercado Livre'
          };
        }
      }
    });

    return statusMap;
  }

  async unpublishProduct(productId: number | string, marketplaceId: string): Promise<any> {
    try {
      const marketplace = await this.registryService.findOne(marketplaceId);
      if (!marketplace) throw new Error('Marketplace não encontrado');

      const product = await this.productModel.findOne({ sku: productId });
      if (!product) throw new Error('Produto não encontrado');

      const mId = marketplace._id;
      // [REF] Fetch listing
      const listings = await this.listingService.findByProduct(product._id);
      const title = listings.find(l => String(l.marketplaceId) === String(mId));

      if (!title || !title.externalId) {
        return { success: true, message: 'Produto não publicado neste marketplace' };
      }

      const adapter = this.adapterRegistry.getProductAdapter(marketplace.name);
      if (!adapter.unpublishProduct) {
        return { success: false, error: `Desativação não suportada para ${marketplace.name}` };
      }

      const result = await adapter.unpublishProduct(title.externalId, marketplace as any);

      if (result.success) {
        // Update listing
        await this.listingService.updateStatus(title.id, 'paused');
      }

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

