import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { InternalProductController } from './internal-product.controller';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { UserModel } from '../auth/schemas/user.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { STOCK_QUERY_PORT } from '../stock/ports/stock-query.port';
import { PRICING_PORT } from '../pricing/ports/pricing.port';
import { CategorySnapshotService } from '../product/services/category-snapshot.service';
import { ProductService } from '../product/product.service';
import { ProductCompatibilityPositionService } from '../product/services/product-compatibility-position.service';
import { StoreService } from '../store/services/store.service';
import { InternalKeyGuard } from './internal-key.guard';

describe('InternalProductController — getListings (catalog listing Fase 2)', () => {
  let controller: InternalProductController;
  let listingModel: { find: jest.Mock; updateOne: jest.Mock };
  let productModel: { findById: jest.Mock };
  let userModel: { findById: jest.Mock };
  let configCache: { getById: jest.Mock; resolveId: jest.Mock };
  let compatibilityPosition: { computeCatalogEligibility: jest.Mock };
  let storeService: { resolveAccountId: jest.Mock };

  const mlMarketplaceId = new Types.ObjectId().toHexString();
  const productId = new Types.ObjectId().toHexString();
  const listingId = new Types.ObjectId();

  function mockLean(returnValue: any) {
    return { lean: () => ({ exec: () => Promise.resolve(returnValue) }) };
  }

  function mockPopulateLean(returnValue: any) {
    return { populate: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) };
  }

  function mockSelectLean(returnValue: any) {
    return { select: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) };
  }

  beforeEach(async () => {
    listingModel = { find: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) };
    productModel = { findById: jest.fn().mockReturnValue({ ...mockPopulateLean(null), ...mockSelectLean(null) }) };
    userModel = { findById: jest.fn().mockReturnValue(mockSelectLean(null)) };
    configCache = {
      getById: jest.fn().mockResolvedValue({ _id: mlMarketplaceId, tag: 'mercadolivre' }),
      resolveId: jest.fn().mockResolvedValue(mlMarketplaceId),
    };
    compatibilityPosition = { computeCatalogEligibility: jest.fn() };
    storeService = { resolveAccountId: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalProductController],
      providers: [
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: getModelToken(ListingModel.name), useValue: listingModel },
        { provide: getModelToken(UserModel.name), useValue: userModel },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
        { provide: MarketplaceDescriptionService, useValue: {} },
        { provide: STOCK_QUERY_PORT, useValue: {} },
        { provide: PRICING_PORT, useValue: {} },
        { provide: CategorySnapshotService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: ProductCompatibilityPositionService, useValue: compatibilityPosition },
        { provide: StoreService, useValue: storeService },
      ],
    })
      .overrideGuard(InternalKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(InternalProductController);
  });

  function pendingListing(overrides: any = {}) {
    return {
      _id: listingId,
      productId: new Types.ObjectId(productId),
      marketplaceId: new Types.ObjectId(mlMarketplaceId),
      status: 'pending_creation',
      title: 'Amortecedor X',
      ...overrides,
    };
  }

  /** productModel.findById é chamado com dois formatos de chain diferentes:
   * .populate().lean().exec() (maybeDecideCatalogListing) e
   * .select().lean().exec() (resolveFallbackStoreId). */
  function mockFindByIdBoth(populateReturnValue: any, selectReturnValue: any = null) {
    productModel.findById.mockReturnValue({
      ...mockPopulateLean(populateReturnValue),
      ...mockSelectLean(selectReturnValue),
    });
  }

  it('grava catalogListing quando elegível e categoria está no piloto', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    mockFindByIdBoth({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } });
    compatibilityPosition.computeCatalogEligibility.mockResolvedValue({
      eligible: true,
      catalogProductId: 'MLB37361266',
    });

    const result = await controller.getListings(productId);

    expect(listingModel.updateOne).toHaveBeenCalledWith(
      { _id: listingId, catalogListing: { $exists: false } },
      { $set: { catalogListing: expect.objectContaining({ enabled: true, catalogProductId: 'MLB37361266' }) } },
    );
    expect(result[0].catalogListing).toEqual(
      expect.objectContaining({ enabled: true, catalogProductId: 'MLB37361266' }),
    );
  });

  it('não recalcula quando o listing já tem catalogListing gravado', async () => {
    listingModel.find.mockReturnValue(
      mockLean([pendingListing({ catalogListing: { enabled: true, catalogProductId: 'MLB1', decidedAt: new Date() } })]),
    );

    await controller.getListings(productId);

    // productModel.findById AINDA é chamado — não pela decisão de catalog listing
    // (que de fato pula, sem elegibilidade recalculada), mas por
    // resolveFallbackStoreId, já que este listing não tem storeId carimbado.
    expect(compatibilityPosition.computeCatalogEligibility).not.toHaveBeenCalled();
    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não grava quando o listing já tem externalId (já publicado)', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing({ externalId: 'MLB999', status: 'active' })]));

    await controller.getListings(productId);

    expect(compatibilityPosition.computeCatalogEligibility).not.toHaveBeenCalled();
    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não grava quando a categoria do produto está fora do piloto', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    mockFindByIdBoth({ category: { _id: 'cat1', mlCategoryId: 'MLB999999' } });

    await controller.getListings(productId);

    expect(compatibilityPosition.computeCatalogEligibility).not.toHaveBeenCalled();
    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não grava quando o produto não é elegível', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    mockFindByIdBoth({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } });
    compatibilityPosition.computeCatalogEligibility.mockResolvedValue({ eligible: false, catalogProductId: null });

    await controller.getListings(productId);

    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não derruba o endpoint quando computeCatalogEligibility lança', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    mockFindByIdBoth({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } });
    compatibilityPosition.computeCatalogEligibility.mockRejectedValue(new Error('ML indisponível'));

    const result = await controller.getListings(productId);

    expect(result).toHaveLength(1);
    expect(result[0].catalogListing).toBeUndefined();
  });

  describe('storeId (identidade do listing)', () => {
    it('usa o storeId já carimbado no listing sem consultar o criador do produto', async () => {
      const storeId = new Types.ObjectId().toHexString();
      listingModel.find.mockReturnValue(mockLean([pendingListing({ storeId })]));
      storeService.resolveAccountId.mockResolvedValue('ACC_1');

      const result = await controller.getListings(productId);

      expect(userModel.findById).not.toHaveBeenCalled();
      expect(result[0].storeId).toBe(storeId);
      expect(storeService.resolveAccountId).toHaveBeenCalledWith(storeId, 'mercadolivre');
    });

    it('sem storeId no listing, resolve via createdByUserId → user.storeId (fallback pré-backfill)', async () => {
      const creatorId = new Types.ObjectId().toHexString();
      const storeId = new Types.ObjectId().toHexString();
      listingModel.find.mockReturnValue(mockLean([pendingListing()]));
      mockFindByIdBoth(null, { createdByUserId: creatorId });
      userModel.findById.mockReturnValue(mockSelectLean({ storeId }));
      storeService.resolveAccountId.mockResolvedValue('ACC_1');

      const result = await controller.getListings(productId);

      expect(userModel.findById).toHaveBeenCalledWith(creatorId);
      expect(result[0].storeId).toBe(storeId);
    });

    it('sem storeId e sem criador resolvível, cai para null (não quebra o endpoint)', async () => {
      listingModel.find.mockReturnValue(mockLean([pendingListing()]));
      mockFindByIdBoth(null, null);

      const result = await controller.getListings(productId);

      expect(result[0].storeId).toBeNull();
      expect(storeService.resolveAccountId).toHaveBeenCalledWith(null, 'mercadolivre');
    });
  });
});
