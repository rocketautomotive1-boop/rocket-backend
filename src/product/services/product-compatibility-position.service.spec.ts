import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ProductCompatibilityPositionService } from './product-compatibility-position.service';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';

describe('ProductCompatibilityPositionService', () => {
  let service: ProductCompatibilityPositionService;
  let compatModel: { findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let productModel: { findById: jest.Mock };
  let categoryModel: { findById: jest.Mock };
  let mlAdapter: { searchCatalogProductsByPartNumber: jest.Mock; getCatalogProduct: jest.Mock };
  let configCache: { getByName: jest.Mock };

  const mlMarketplaceId = '507f1f77bcf86cd799439011';
  const categoryId = '507f1f77bcf86cd799439022';

  beforeEach(async () => {
    compatModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
    productModel = { findById: jest.fn() };
    categoryModel = { findById: jest.fn() };
    mlAdapter = { searchCatalogProductsByPartNumber: jest.fn(), getCatalogProduct: jest.fn() };
    configCache = { getByName: jest.fn().mockResolvedValue({ _id: mlMarketplaceId }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductCompatibilityPositionService,
        { provide: getModelToken('ProductCompatibilityModel'), useValue: compatModel },
        { provide: getModelToken('ProductModel'), useValue: productModel },
        { provide: getModelToken('CategoryModel'), useValue: categoryModel },
        { provide: MercadoLivreCompatibilityAdapter, useValue: mlAdapter },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
      ],
    }).compile();

    service = moduleRef.get(ProductCompatibilityPositionService);
  });

  function mockLean(returnValue: any) {
    return { lean: () => ({ exec: () => Promise.resolve(returnValue) }) };
  }

  it('resolve e grava posição quando há match exato de part_number', async () => {
    compatModel.findById.mockReturnValue(mockLean({ _id: 'c1', productId: 'p1' }));
    productModel.findById.mockReturnValue(
      mockLean({ _id: 'p1', partNumber: 'GBL1252', brand: { name: 'Cofap' }, category: categoryId }),
    );
    categoryModel.findById.mockReturnValue(
      mockLean({
        _id: categoryId,
        marketplaceMappings: [{ marketplaceId: mlMarketplaceId, externalId: 'MLB22709' }],
      }),
    );
    mlAdapter.searchCatalogProductsByPartNumber.mockResolvedValue([
      { catalog_product_id: 'MLB37361266', attributes: [{ id: 'PART_NUMBER', value_name: 'GBL1252' }] },
    ]);
    mlAdapter.getCatalogProduct.mockResolvedValue({
      catalog_product_id: 'MLB37361266',
      attributes: [
        { id: 'PART_NUMBER', value_name: 'GBL1252' },
        { id: 'POSITION', value_id: '13701105', value_name: 'Traseira' },
      ],
    });

    await service.resolveForCompatibility('c1');

    expect(compatModel.findByIdAndUpdate).toHaveBeenCalledWith('c1', {
      $set: {
        mlCatalogProductId: 'MLB37361266',
        position: '13701105',
        positionName: 'Traseira',
        sidePosition: undefined,
        sidePositionName: undefined,
        positionNeedsReview: false,
      },
    });
  });

  it('marca positionNeedsReview quando produto não tem partNumber ou brand', async () => {
    compatModel.findById.mockReturnValue(mockLean({ _id: 'c1', productId: 'p1' }));
    productModel.findById.mockReturnValue(mockLean({ _id: 'p1', partNumber: '', category: 'cat1' }));

    await service.resolveForCompatibility('c1');

    expect(compatModel.findByIdAndUpdate).toHaveBeenCalledWith('c1', {
      $set: { positionNeedsReview: true },
    });
    expect(mlAdapter.searchCatalogProductsByPartNumber).not.toHaveBeenCalled();
  });

  it('marca positionNeedsReview quando produto não tem categoria mapeada para ML', async () => {
    compatModel.findById.mockReturnValue(mockLean({ _id: 'c1', productId: 'p1' }));
    productModel.findById.mockReturnValue(
      mockLean({ _id: 'p1', partNumber: 'X1', brand: { name: 'Y' }, category: categoryId }),
    );
    categoryModel.findById.mockReturnValue(mockLean({ _id: categoryId, marketplaceMappings: [] }));

    await service.resolveForCompatibility('c1');

    expect(compatModel.findByIdAndUpdate).toHaveBeenCalledWith('c1', {
      $set: { positionNeedsReview: true },
    });
  });

  it('marca positionNeedsReview quando não há match exato no ML', async () => {
    compatModel.findById.mockReturnValue(mockLean({ _id: 'c1', productId: 'p1' }));
    productModel.findById.mockReturnValue(
      mockLean({ _id: 'p1', partNumber: 'X1', brand: { name: 'Y' }, category: categoryId }),
    );
    categoryModel.findById.mockReturnValue(
      mockLean({ _id: categoryId, marketplaceMappings: [{ marketplaceId: mlMarketplaceId, externalId: 'MLB22709' }] }),
    );
    mlAdapter.searchCatalogProductsByPartNumber.mockResolvedValue([]);

    await service.resolveForCompatibility('c1');

    expect(compatModel.findByIdAndUpdate).toHaveBeenCalledWith('c1', {
      $set: { positionNeedsReview: true },
    });
    expect(mlAdapter.getCatalogProduct).not.toHaveBeenCalled();
  });

  it('não faz nada quando a compatibilidade não existe', async () => {
    compatModel.findById.mockReturnValue(mockLean(null));

    await service.resolveForCompatibility('c1');

    expect(compatModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
