import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { InternalProductController } from './internal-product.controller';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { STOCK_QUERY_PORT } from '../stock/ports/stock-query.port';
import { PRICING_PORT } from '../pricing/ports/pricing.port';
import { CategorySnapshotService } from '../product/services/category-snapshot.service';
import { ProductService } from '../product/product.service';
import { ProductCompatibilityPositionService } from '../product/services/product-compatibility-position.service';
import { InternalKeyGuard } from './internal-key.guard';

describe('InternalProductController — getListings (catalog listing Fase 2)', () => {
  let controller: InternalProductController;
  let listingModel: { find: jest.Mock; updateOne: jest.Mock };
  let productModel: { findById: jest.Mock };
  let configCache: { getById: jest.Mock; resolveId: jest.Mock };
  let compatibilityPosition: { computeCatalogEligibility: jest.Mock };

  const mlMarketplaceId = new Types.ObjectId().toHexString();
  const productId = new Types.ObjectId().toHexString();
  const listingId = new Types.ObjectId();

  function mockLean(returnValue: any) {
    return { lean: () => ({ exec: () => Promise.resolve(returnValue) }) };
  }

  function mockPopulateLean(returnValue: any) {
    return { populate: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) };
  }

  beforeEach(async () => {
    listingModel = { find: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) };
    productModel = { findById: jest.fn() };
    configCache = {
      getById: jest.fn().mockResolvedValue({ _id: mlMarketplaceId, tag: 'mercadolivre' }),
      resolveId: jest.fn().mockResolvedValue(mlMarketplaceId),
    };
    compatibilityPosition = { computeCatalogEligibility: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [InternalProductController],
      providers: [
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: getModelToken(ListingModel.name), useValue: listingModel },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
        { provide: MarketplaceDescriptionService, useValue: {} },
        { provide: STOCK_QUERY_PORT, useValue: {} },
        { provide: PRICING_PORT, useValue: {} },
        { provide: CategorySnapshotService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: ProductCompatibilityPositionService, useValue: compatibilityPosition },
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

  it('grava catalogListing quando elegível e categoria está no piloto', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    productModel.findById.mockReturnValue(
      mockPopulateLean({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } }),
    );
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

    expect(productModel.findById).not.toHaveBeenCalled();
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
    productModel.findById.mockReturnValue(
      mockPopulateLean({ category: { _id: 'cat1', mlCategoryId: 'MLB999999' } }),
    );

    await controller.getListings(productId);

    expect(compatibilityPosition.computeCatalogEligibility).not.toHaveBeenCalled();
    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não grava quando o produto não é elegível', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    productModel.findById.mockReturnValue(
      mockPopulateLean({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } }),
    );
    compatibilityPosition.computeCatalogEligibility.mockResolvedValue({ eligible: false, catalogProductId: null });

    await controller.getListings(productId);

    expect(listingModel.updateOne).not.toHaveBeenCalled();
  });

  it('não derruba o endpoint quando computeCatalogEligibility lança', async () => {
    listingModel.find.mockReturnValue(mockLean([pendingListing()]));
    productModel.findById.mockReturnValue(
      mockPopulateLean({ category: { _id: 'cat1', mlCategoryId: 'MLB22709' } }),
    );
    compatibilityPosition.computeCatalogEligibility.mockRejectedValue(new Error('ML indisponível'));

    const result = await controller.getListings(productId);

    expect(result).toHaveLength(1);
    expect(result[0].catalogListing).toBeUndefined();
  });
});
