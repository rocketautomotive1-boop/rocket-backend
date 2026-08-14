import { Injectable, Inject, forwardRef, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument, ProductTitle } from '../schemas/product.schema';
import { ListingService } from '../../listing/listing.service';
import { ListingDocument } from '../../listing/schemas/listing.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRODUCT_SECTION_EVENTS, ProductTitlesSavedEvent } from '../events/product-section-saved.event';

@Injectable()
export class ProductTitleService {
  private readonly logger = new Logger(ProductTitleService.name);

  constructor(
    @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
    private readonly listingService: ListingService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /** storeId já resolvido pelo controller (req.user.storeId) — snapshot gravado uma única vez. */
  private toStoreObjectId(storeId?: string | null): Types.ObjectId | undefined {
    return storeId && Types.ObjectId.isValid(storeId) ? new Types.ObjectId(storeId) : undefined;
  }

  private toDto(listing: ListingDocument | any): any {
    if (!listing) return null;
    return {
      id: listing._id ? listing._id.toString() : listing.id,
      title: listing.title,
      locale: listing.locale || 'pt-BR',
      marketplaceId: listing.marketplaceId ? listing.marketplaceId.toString() : undefined,
      externalId: listing.externalId,
      marketplaceData: listing.marketplaceData,
      _id: listing._id ? listing._id.toString() : undefined,
      storeId: listing.storeId ? listing.storeId.toString() : undefined,
    };
  }

  async findByProductId(productId: number | string): Promise<any[]> {
    const pId = await this.resolveProductId(productId);
    if (!pId) return [];

    const listings = await this.listingService.findByProduct(pId);
    return listings.map(t => this.toDto(t));
  }

  /**
   * Títulos restritos a UMA loja — usado pela tela de Títulos (isolamento por loja): cada
   * loja só pode ver seus próprios anúncios. findByProductId (sem filtro) continua sendo
   * usado por readiness/product.service, que legitimamente precisam saber "o produto tem
   * título de QUALQUER loja", não de uma loja específica.
   */
  async findByProductIdAndStore(productId: number | string, storeId: string): Promise<any[]> {
    const pId = await this.resolveProductId(productId);
    if (!pId) return [];

    const listings = await this.listingService.findByProductAndStore(pId, storeId);
    return listings.map(t => this.toDto(t));
  }

  // Helper to resolve SKU/PartNumber to ObjectId
  private async resolveProductId(id: number | string): Promise<string | null> {
    if (typeof id === 'string' && Types.ObjectId.isValid(id)) return id;

    // Fallback: look up in Product
    const query = this.buildIdQuery(id);
    const product = await this.productModel.findOne(query).select('_id').lean();
    return product ? product._id.toString() : null;
  }

  async findByProductIdWithMarketplace(productId: number | string): Promise<any[]> {
    return this.findByProductId(productId);
  }

  async findByProductIdAndMarketplace(productId: number | string, marketplaceName: string): Promise<any[]> {
    return this.findByProductId(productId);
  }

  async findByExternalId(externalId: string): Promise<any | null> {
    const listing = await this.listingService.findOne({ externalId });
    if (listing) {
      // Legacy expectation: Return the PRODUCT, not the title DTO?
      // Original code: return product; // Return full product
      // We must fetch the product now.
      return this.productModel.findById(listing.productId).exec();
    }
    return null;
  }

  async findById(id: any): Promise<any | null> { // Changed return type to any since ProductTitle interface might be deprecated
    const listing = await this.listingService.findById(id);
    if (!listing) return null;
    // Map to ProductTitle-like object if necessary, but DTO is preferred
    return this.toDto(listing);
  }

  async save(title: ProductTitle): Promise<ProductTitle> {
    // Adapter for legacy save calls.
    // 'title' is likely a plain object or DTO cast as ProductTitle
    const id = (title as any)._id || (title as any).id;
    if (id) {
      await this.listingService.update(id, title as any);
      return title;
    }
    throw new Error('Save requires an ID in new architecture. Use create/update definitions.');
  }

  async findOne(id: number | string): Promise<any> {
    const listing = await this.listingService.findById(String(id));
    if (!listing) throw new NotFoundException('Title not found');

    return {
      ...this.toDto(listing),
      product: { id: listing.productId.toString() }
    };
  }

  async findByExternalIdAndMarketplaceId(externalId: string, marketplaceId: string): Promise<any | null> {
    const listing = await this.listingService.findOne({
      externalId,
      marketplaceId: new Types.ObjectId(marketplaceId)
    });

    if (!listing) return null;
    return { ...this.toDto(listing), product: { id: listing.productId.toString() } };
  }

  async findByMarketplaceId(marketplaceId: string): Promise<any[]> {
    const listings = await this.listingService.findByMarketplaceId(new Types.ObjectId(marketplaceId));

    // Need to wrap result to include product ID structure expected by legacy callers?
    // Original: titles.push(...matched.map(t => ({ ...this.toDto(t), product: { id: p._id.toString() } })));
    return listings.map(l => ({ ...this.toDto(l), product: { id: l.productId.toString() } }));
  }

  async create(productId: number | string, titleData: Partial<ProductTitle>): Promise<any> {
    const pId = await this.resolveProductId(productId);
    if (!pId) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

    let mId: Types.ObjectId | undefined;
    if (titleData.marketplaceId) {
      if (titleData.marketplaceId instanceof Types.ObjectId) mId = titleData.marketplaceId;
      else if (Types.ObjectId.isValid(String(titleData.marketplaceId))) mId = new Types.ObjectId(String(titleData.marketplaceId));
    }

    const storeId = this.toStoreObjectId((titleData as any).storeId);

    const newListing = await this.listingService.create({
      ...titleData as any,
      productId: new Types.ObjectId(pId),
      marketplaceId: mId,
      storeId,
      status: (titleData as any).status || 'pending_creation',
      synchronized: true
    });

    return { ...this.toDto(newListing), product: { id: pId } };
  }

  async update(id: number | string, titleData: Partial<ProductTitle>): Promise<any> {
    const listing = await this.listingService.update(String(id), titleData as any);
    if (!listing) throw new NotFoundException(`Title ${id} not found`);
    return { ...this.toDto(listing), product: { id: listing.productId.toString() } };
  }

  async remove(id: number | string): Promise<boolean> {
    const result = await this.listingService.delete(String(id));
    return !!result;
  }

  async removeAllByProductId(productId: number | string): Promise<boolean> {
    const pId = await this.resolveProductId(productId);
    if (!pId) return false;
    await this.listingService.deleteByProduct(pId);
    return true;
  }

  // Mirror Logic (Complex Sync)
  async updateTitles(productId: number | string, titles: { id?: string | number, title: string; locale?: string; marketplaceId?: string; order?: number }[], userId?: number, storeId?: string | null): Promise<any[]> {
    const pId = await this.resolveProductId(productId);
    if (!pId) throw new Error(`Produto com ID ${productId} não encontrado`);

    const pObjectId = new Types.ObjectId(pId);
    const storeObjectId = this.toStoreObjectId(storeId);

    // 1. Get existing listings — restrito à loja do usuário: sem isso, um batch de uma loja
    // apagaria/reeditaria listings de OUTRA loja "que não vieram" no payload dela (bug real,
    // ver docs/superpowers/specs/2026-08-14-titles-store-isolation-design.md).
    const existingListings = storeObjectId
      ? await this.listingService.findByProductAndStore(pObjectId, storeObjectId)
      : [];
    const existingIds = new Set(existingListings.map(l => l._id.toString()));

    // 2. Identification
    const incomingIds = new Set<string>();
    titles.forEach(t => { if (t.id) incomingIds.add(t.id.toString()); });

    // 3. Delete missing
    const toDelete = existingListings.filter(l => !incomingIds.has(l._id.toString()));
    for (const l of toDelete) {
      await this.listingService.delete(l._id.toString());
    }

    const resultTitles = [];

    // 4. Update or Create
    for (const t of titles) {
      if (!t.marketplaceId) continue;

      let mId: Types.ObjectId;
      try {
        mId = new Types.ObjectId(String(t.marketplaceId));
      } catch { continue; }

      if (t.id && existingIds.has(t.id.toString())) {
        // Update
        const updated = await this.listingService.update(t.id.toString(), {
          title: t.title,
          locale: t.locale,
          marketplaceId: mId,
          marketplaceData: { userId }
          // order field not in listing schema yet, might need ignoring or adding if important
        });
        resultTitles.push(updated);
      } else {
        // Create — storeId é gravado uma única vez aqui (snapshot imutável), não
        // recalculado em edições/re-sync futuras deste mesmo listing.
        const created = await this.listingService.create({
          productId: pObjectId,
          marketplaceId: mId,
          storeId: storeObjectId,
          title: t.title,
          locale: t.locale || 'pt-BR',
          status: 'active',
          marketplaceData: { userId }
        });
        resultTitles.push(created);
      }
    }

    const result = resultTitles.map(t => this.toDto(t));

    try {
      this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.TITLES_SAVED, new ProductTitlesSavedEvent(pId));
    } catch {}

    return result;
  }

  async updateMarketplaceStatus(
    productId: number | string,
    marketplaceId: string,
    externalId: string,
    status: string,
    marketplaceData?: any
  ): Promise<any> {
    const pId = await this.resolveProductId(productId);
    if (!pId) throw new Error(`Product ${productId} not found`);

    const mId = new Types.ObjectId(marketplaceId);

    // Logic: Find by ExternalID + MktID primarily
    let listing = null;
    if (externalId) {
      listing = await this.listingService.findOne({
        marketplaceId: mId,
        externalId: externalId
      });
    }

    // Context aware fallback (internal ID in metadata)
    if (!listing && marketplaceData?._internalTitleId) {
      listing = await this.listingService.findById(marketplaceData._internalTitleId);
    }

    if (!listing) {
      // Create New
      listing = await this.listingService.create({
        productId: new Types.ObjectId(pId),
        marketplaceId: mId,
        title: marketplaceData?.title || 'Novo Anúncio', // Fallback title
        externalId: externalId,
        status: status === 'active' ? 'active' : 'pending_creation', // Map status
        marketplaceData: marketplaceData,
        lastSyncAt: new Date(),
        locale: 'pt-BR'
      });
    } else {
      // Update
      listing = await this.listingService.update(listing._id.toString(), {
        externalId: externalId,
        status: status === 'active' ? 'active' : status, // Map status? Listing uses 'active', 'paused', etc.
        lastSyncAt: new Date(),
        marketplaceData: marketplaceData ? { ...(listing.marketplaceData || {}), ...marketplaceData } : listing.marketplaceData,
        title: marketplaceData?.title || listing.title
      });
    }

    return this.toDto(listing);
  }

  async upsertProductTitle(productId: number | string, marketplaceId: string, data: any): Promise<any> {
    const pId = await this.resolveProductId(productId);
    if (!pId) throw new NotFoundException('Produto não encontrado');

    const mId = new Types.ObjectId(marketplaceId);

    // This method seems redundant with updateMarketplaceStatus but uses explicit data object
    const updateData: any = {
      marketplaceId: mId,
      externalId: data.externalId,
      status: data.status === 'active' ? 'active' : (data.status || 'pending_creation'),
      lastSyncAt: new Date(),
      marketplaceData: data.marketplaceData,
      productId: new Types.ObjectId(pId)
    };

    if (data.marketplaceData?.title) updateData.title = data.marketplaceData.title;

    // Use createOrUpdate logic which keys off externalId
    // But if we don't have externalId, we might create duplicate if we are not careful.
    // The previous implementation used array find.

    let listing;
    if (data.externalId) {
      listing = await this.listingService.createOrUpdate(updateData);
    } else {
      // Fallback to finding by Title?? Or just create?
      // Original logic: if (!title) title = { ... } push;
      // Without externalId, we probably should create a new one unless we find closely matching one?
      // Let's assume create for now to be safe, or map strictly.
      updateData.title = updateData.title || 'Untitled';
      listing = await this.listingService.create(updateData);
    }

    return this.toDto(listing);
  }

  async ensurePersistence(
    productId: number | string,
    marketplaceId: string,
    externalId: string,
    status: string,
    marketplaceData: any
  ): Promise<any> {
    try {
      await this.updateMarketplaceStatus(productId, marketplaceId, externalId, status, marketplaceData);
      return true;
    } catch (e) {
      this.logger.error(`ensurePersistence error: ${e.message}`);
      return null;
    }
  }

  async getMarketplaceStatus(productId: number | string, marketplaceId: string): Promise<any> {
    const pId = await this.resolveProductId(productId);
    if (!pId) return { status: 'not_integrated', message: 'Produto não encontrado' };

    const listing = await this.listingService.findOne({
      productId: new Types.ObjectId(pId),
      marketplaceId: new Types.ObjectId(marketplaceId)
    });

    if (!listing) {
      return { status: 'not_integrated', message: 'Título não encontrado' };
    }

    return {
      status: listing.status,
      externalId: listing.externalId,
      lastSyncAt: listing.lastSyncAt,
      marketplaceData: listing.marketplaceData
    };
  }

  private buildIdQuery(id: number | string): any {
    if (typeof id === 'string' && Types.ObjectId.isValid(id)) {
      return { _id: id };
    }
    return { partNumber: String(id) }; // Fallback: treat as partNumber
  }
}
