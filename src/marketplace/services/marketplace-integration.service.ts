import { Injectable, Inject, forwardRef, Logger, BadRequestException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { ListingService } from '../../listing/listing.service';
import { ListingDocument } from '../../listing/schemas/listing.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MercadoLivreListingAdapter } from '../adapters/mercado-livre/mercado-livre-listing.adapter';

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
    private readonly mercadoLivreListingAdapter: MercadoLivreListingAdapter,
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

  /**
   * Proxy da busca ML GET /users/{seller_id}/items/search (offset/limit, máx. 50).
   */
  async searchMercadoLivreUserItems(params?: { offset?: number; limit?: number; order?: string; tags?: string }): Promise<any> {
    const ml = await this.registryService.findByName('Mercado Livre');
    if (!ml) {
      throw new BadRequestException('Mercado Livre não configurado.');
    }
    try {
      return await this.mercadoLivreListingAdapter.searchUserItems({
        offset: params?.offset ?? 0,
        limit: params?.limit !== undefined ? Math.min(50, Math.max(1, params.limit)) : 50,
        order: params?.order,
        tags: params?.tags,
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message || 'Falha ao consultar anúncios no Mercado Livre.';
      this.logger.warn(`searchMercadoLivreUserItems: ${msg}`);
      if (status === 401) {
        throw new BadRequestException('Token do Mercado Livre inválido ou expirado. Autentique novamente.');
      }
      throw new BadRequestException(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  /**
   * Lista paginada via GET /users/{id}/items/search (opcional tags, ex.: incomplete_compatibilities),
   * com multiget ML + vínculo productId em listings (Mongo).
   */
  async getMercadoLivreListingsFromItemsSearch(params: {
    offset?: number;
    limit?: number;
    tags?: string;
  }): Promise<{
    seller_id?: string;
    results: string[];
    items: any[];
    paging: { limit: number; offset: number; total: number };
  }> {
    const ml = await this.registryService.findByName('Mercado Livre');
    if (!ml) {
      throw new BadRequestException('Mercado Livre não configurado.');
    }
    const mId = ml._id as Types.ObjectId;
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const tags = params.tags?.trim();

    let raw: any;
    try {
      raw = await this.mercadoLivreListingAdapter.searchUserItems({
        offset,
        limit,
        tags,
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message || 'Falha ao consultar anúncios no Mercado Livre.';
      this.logger.warn(`getMercadoLivreListingsFromItemsSearch: ${msg}`);
      if (status === 401) {
        throw new BadRequestException('Token do Mercado Livre inválido ou expirado. Autentique novamente.');
      }
      throw new BadRequestException(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    const externalIds: string[] = (raw?.results || []).map((id: any) => String(id));
    const paging = raw?.paging || { limit, offset, total: 0 };
    const seller_id =
      raw?.seller_id != null ? String(raw.seller_id) : await this.mercadoLivreListingAdapter.getSellerId();

    let multiget: any[] = [];
    if (externalIds.length) {
      const chunkSize = 20;
      for (let i = 0; i < externalIds.length; i += chunkSize) {
        const chunk = externalIds.slice(i, i + chunkSize);
        try {
          const part = await this.mercadoLivreListingAdapter.getListingMultigetByIds(chunk.join(','));
          multiget.push(...part);
        } catch (err: any) {
          this.logger.warn(`Multiget items-search: ${err?.message}`);
        }
      }
    }

    const bodyByExternal = new Map<string, any>();
    for (const m of multiget) {
      const b = m?.body;
      if (b?.id) bodyByExternal.set(String(b.id), b);
    }

    const listingByExternal = new Map<string, { productId?: string; listingId?: string }>();
    if (externalIds.length) {
      const docs = await this.listingService.listingModel
        .find({ marketplaceId: mId, externalId: { $in: externalIds } })
        .select('_id productId externalId')
        .lean()
        .exec();
      for (const d of docs as any[]) {
        listingByExternal.set(String(d.externalId), {
          productId: d.productId ? String(d.productId) : undefined,
          listingId: d._id ? String(d._id) : undefined,
        });
      }
    }

    const mpId = String(ml.id ?? ml._id);
    const items = externalIds.map((extId) => {
      const body = bodyByExternal.get(extId);
      const link = listingByExternal.get(extId);
      const itemTags = Array.isArray(body?.tags)
        ? body.tags.map((t: any) => String(t))
        : [];
      return {
        id: body?.id || extId,
        title: body?.title ?? '',
        price: body?.price ?? 0,
        available_quantity: body?.available_quantity ?? 0,
        sold_quantity: body?.sold_quantity ?? 0,
        status: body?.status ?? '',
        thumbnail: body?.thumbnail ?? '',
        permalink: body?.permalink ?? '',
        date_created: body?.date_created ?? '',
        tags: itemTags,
        productId: link?.productId,
        listingId: link?.listingId,
        externalId: extId,
        marketplace: {
          id: mpId,
          name: 'Mercado Livre',
          type: 'mercadolivre',
          icon: 'store',
        },
      };
    });

    return {
      seller_id,
      results: externalIds,
      items,
      paging: {
        limit: paging.limit ?? limit,
        offset: paging.offset ?? offset,
        total: paging.total ?? 0,
      },
    };
  }

  /**
   * Listagens ML cujo produto não possui compatibilidades em product_compatibilities (paginação Mongo + detalhe ML).
   */
  async getMercadoLivreListingsWithoutCompatibilities(params: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    seller_id?: string;
    results: string[];
    items: any[];
    paging: { limit: number; offset: number; total: number };
  }> {
    const ml = await this.registryService.findByName('Mercado Livre');
    if (!ml) {
      throw new BadRequestException('Mercado Livre não configurado.');
    }
    const mId = ml._id as Types.ObjectId;
    const offset = Math.max(0, params.offset ?? 0);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const search = params.search?.trim();

    const sellerId = await this.mercadoLivreListingAdapter.getSellerId();

    const pipeline: any[] = [
      {
        $match: {
          marketplaceId: mId,
          externalId: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $lookup: {
          from: 'product_compatibilities',
          let: { pid: '$productId' },
          pipeline: [{ $match: { $expr: { $eq: ['$product', '$$pid'] } } }],
          as: 'compatRows',
        },
      },
      { $match: { compatRows: { $size: 0 } } },
    ];

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push(
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'p',
          },
        },
        { $unwind: { path: '$p', preserveNullAndEmptyArrays: false } },
        {
          $match: {
            $or: [
              { 'p.name': { $regex: escaped, $options: 'i' } },
              { 'p.partNumber': { $regex: escaped, $options: 'i' } },
              { 'p.sku': { $regex: escaped, $options: 'i' } },
            ],
          },
        },
      );
    }

    pipeline.push({ $sort: { updatedAt: -1 } });
    pipeline.push({
      $facet: {
        totalCount: [{ $count: 'count' }],
        page: [{ $skip: offset }, { $limit: limit }],
      },
    });

    const agg = await this.listingService.listingModel.aggregate(pipeline).exec();
    const facet = agg[0] || { totalCount: [], page: [] };
    const total = facet.totalCount?.[0]?.count ?? 0;
    const pageDocs: ListingDocument[] = facet.page || [];

    const externalIds = pageDocs.map((l: any) => l.externalId).filter(Boolean);
    let multiget: any[] = [];
    if (externalIds.length) {
      try {
        const idsString = externalIds.join(',');
        multiget = await this.mercadoLivreListingAdapter.getListingMultigetByIds(idsString);
      } catch (err: any) {
        this.logger.warn(`Multiget ML sem compat: ${err?.message}`);
      }
    }

    const bodyByExternal = new Map<string, any>();
    for (const m of multiget) {
      const b = m?.body;
      if (b?.id) bodyByExternal.set(String(b.id), b);
    }

    const mpId = String(ml.id ?? ml._id);
    const items = pageDocs.map((doc: any) => {
      const body = bodyByExternal.get(String(doc.externalId));
      return {
        id: body?.id || doc.externalId,
        title: body?.title ?? doc.title,
        price: body?.price ?? doc.price ?? 0,
        available_quantity: body?.available_quantity ?? 0,
        sold_quantity: body?.sold_quantity ?? 0,
        status: body?.status ?? doc.status,
        thumbnail: body?.thumbnail ?? '',
        permalink: body?.permalink ?? '',
        date_created: body?.date_created ?? doc.createdAt,
        productId: doc.productId ? String(doc.productId) : undefined,
        listingId: doc._id ? String(doc._id) : undefined,
        externalId: doc.externalId,
        marketplace: {
          id: mpId,
          name: 'Mercado Livre',
          type: 'mercadolivre',
          icon: 'store',
        },
      };
    });

    return {
      seller_id: sellerId,
      results: externalIds,
      items,
      paging: { limit, offset, total },
    };
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
      productId: products.find(p => String(p._id) === String(l.productId))?._id?.toString()
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

