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
import { STORE_LISTING_PORT } from '../store-listing/ports/store-listing.port';
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
        { provide: STORE_LISTING_PORT, useValue: {} },
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

    it('sem storeId no listing, resolve via marketplaceData.userId → user.storeId (sinal do operador, prioridade sobre o criador)', async () => {
      const operatorId = new Types.ObjectId().toHexString();
      const creatorId = new Types.ObjectId().toHexString();
      const storeId = new Types.ObjectId().toHexString();
      listingModel.find.mockReturnValue(mockLean([pendingListing({ marketplaceData: { userId: operatorId } })]));
      mockFindByIdBoth(null, { createdByUserId: creatorId });
      userModel.findById.mockReturnValue(mockSelectLean({ storeId }));
      storeService.resolveAccountId.mockResolvedValue('ACC_1');

      const result = await controller.getListings(productId);

      expect(userModel.findById).toHaveBeenCalledWith(operatorId);
      expect(result[0].storeId).toBe(storeId);
    });

    it('regressão: sem storeId no listing, marketplaceData.userId aponta pra loja DIFERENTE do criador do produto — usa o operador, não o criador (caso real Djalma/RCK_AUTOMOTIVE publicado como se fosse do criador)', async () => {
      const operatorId = new Types.ObjectId().toHexString();
      const creatorId = new Types.ObjectId().toHexString();
      const operatorStoreId = new Types.ObjectId().toHexString();
      const creatorStoreId = new Types.ObjectId().toHexString();
      listingModel.find.mockReturnValue(mockLean([pendingListing({ marketplaceData: { userId: operatorId } })]));
      mockFindByIdBoth(null, { createdByUserId: creatorId });
      userModel.findById.mockImplementation((id: string) =>
        mockSelectLean(id === operatorId ? { storeId: operatorStoreId } : { storeId: creatorStoreId }),
      );

      const result = await controller.getListings(productId);

      expect(result[0].storeId).toBe(operatorStoreId);
      expect(result[0].storeId).not.toBe(creatorStoreId);
    });

    it('sem storeId no listing e sem operador, resolve via createdByUserId → user.storeId (fallback secundário)', async () => {
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

    it('sem storeId, sem operador e sem criador resolvível, cai para null (não quebra o endpoint, e NÃO usa loja padrão)', async () => {
      listingModel.find.mockReturnValue(mockLean([pendingListing()]));
      mockFindByIdBoth(null, null);

      const result = await controller.getListings(productId);

      expect(result[0].storeId).toBeNull();
      expect(storeService.resolveAccountId).toHaveBeenCalledWith(null, 'mercadolivre');
    });
  });
});

describe('InternalProductController — getProduct (gate de readiness por loja)', () => {
  let controller: InternalProductController;
  let productModel: { findById: jest.Mock };
  let productService: { getProductCompletion: jest.Mock };
  let stockQuery: { getProductStock: jest.Mock };
  let pricing: { getBasePrice: jest.Mock; getEffectivePrice: jest.Mock };
  let storeListingPort: { getStockSummary: jest.Mock };

  const productId = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    productModel = {
      findById: jest.fn().mockReturnValue({
        populate: () => ({ lean: () => ({ exec: () => Promise.resolve({ _id: productId, name: 'X' }) }) }),
      }),
    };
    productService = { getProductCompletion: jest.fn().mockResolvedValue({ readyToPublish: true }) };
    stockQuery = { getProductStock: jest.fn().mockResolvedValue({ onHand: 5 }) };
    pricing = {
      getBasePrice: jest.fn().mockResolvedValue(10),
      getEffectivePrice: jest.fn().mockResolvedValue(10),
    };
    storeListingPort = {
      getStockSummary: jest.fn().mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalProductController],
      providers: [
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: getModelToken(ListingModel.name), useValue: {} },
        { provide: getModelToken(UserModel.name), useValue: {} },
        { provide: MarketplaceConfigCacheService, useValue: { resolveId: jest.fn().mockResolvedValue(null) } },
        { provide: MarketplaceDescriptionService, useValue: {} },
        { provide: STOCK_QUERY_PORT, useValue: stockQuery },
        { provide: PRICING_PORT, useValue: pricing },
        { provide: CategorySnapshotService, useValue: {} },
        { provide: ProductService, useValue: productService },
        { provide: ProductCompatibilityPositionService, useValue: {} },
        { provide: StoreService, useValue: {} },
        { provide: STORE_LISTING_PORT, useValue: storeListingPort },
      ],
    })
      .overrideGuard(InternalKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(InternalProductController);
  });

  it('propaga storeId do query param pra getProductCompletion', async () => {
    const storeId = new Types.ObjectId().toHexString();

    await controller.getProduct(productId, undefined, storeId);

    expect(productService.getProductCompletion).toHaveBeenCalledWith(productId, storeId);
  });

  it('sem storeId, chama getProductCompletion com undefined (mantém o fallback existente)', async () => {
    await controller.getProduct(productId);

    expect(productService.getProductCompletion).toHaveBeenCalledWith(productId, undefined);
  });

  it('readyToPublish reflete o resultado de getProductCompletion para o storeId pedido', async () => {
    productService.getProductCompletion.mockResolvedValue({ readyToPublish: false });

    const result = await controller.getProduct(productId, undefined, 'store-x');

    expect(result.readyToPublish).toBe(false);
  });

  describe('stockQuantity (estoque multi-loja)', () => {
    it('com storeId, usa o saldo DESSA loja (StoreListing), não o agregado entre lojas', async () => {
      const storeId = new Types.ObjectId().toHexString();
      // Agregado legado somaria 2 (1 unidade em cada uma de 2 lojas) — regressão real:
      // item publicado no ML com available_quantity=2 quando cada loja só tinha 1.
      stockQuery.getProductStock.mockResolvedValue({ onHand: 2 });
      storeListingPort.getStockSummary.mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 0 });

      const result = await controller.getProduct(productId, undefined, storeId);

      expect(storeListingPort.getStockSummary).toHaveBeenCalledWith(productId, storeId);
      expect(result.stockQuantity).toBe(1);
    });

    it('sem storeId, mantém o comportamento legado (agregado entre lojas)', async () => {
      stockQuery.getProductStock.mockResolvedValue({ onHand: 2 });

      const result = await controller.getProduct(productId);

      expect(storeListingPort.getStockSummary).not.toHaveBeenCalled();
      expect(result.stockQuantity).toBe(2);
    });
  });
});
