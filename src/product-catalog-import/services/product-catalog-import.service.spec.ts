import { Test } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ProductCatalogImportService } from './product-catalog-import.service';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import { ProductModel } from '../../product/schemas/product.schema';
import { CategoryModel } from '../../product/schemas/category.schema';
import { BrandModel } from '../../product/schemas/brand.schema';
import { ProductCompatibilityModel } from '../../product/schemas/product-compatibility.schema';
import { VehicleCompatibilityModel } from '../../vehicle-compatibility/schemas/vehicle-compatibility.schema';

describe('ProductCatalogImportService', () => {
  let service: ProductCatalogImportService;
  let mlCompatAdapter: {
    searchCatalogProductsByGtin: jest.Mock;
    getCatalogProduct: jest.Mock;
    searchProductCompatibilities: jest.Mock;
  };
  let configCache: { resolveId: jest.Mock };
  let productModel: any;
  let categoryModel: { findOne: jest.Mock };
  let brandModel: { findById: jest.Mock; findOne: jest.Mock; create: jest.Mock };
  let compatibilityModel: { find: jest.Mock; insertMany: jest.Mock };
  let vehicleModel: { find: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: { startTransaction: jest.Mock; commitTransaction: jest.Mock; abortTransaction: jest.Mock; endSession: jest.Mock };

  function mockLean(returnValue: any) {
    return { select: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) };
  }

  /** compatibilityModel.find(...).select().session().lean().exec() */
  function mockSelectSessionLean(returnValue: any) {
    return { select: () => ({ session: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) }) };
  }

  /** vehicleModel.find(...).session().lean().exec() */
  function mockSessionLean(returnValue: any) {
    return { session: () => ({ lean: () => ({ exec: () => Promise.resolve(returnValue) }) }) };
  }

  beforeEach(async () => {
    mlCompatAdapter = {
      searchCatalogProductsByGtin: jest.fn(),
      getCatalogProduct: jest.fn(),
      searchProductCompatibilities: jest.fn(),
    };
    configCache = { resolveId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011') };
    productModel = {
      create: jest.fn(),
      findById: jest.fn(),
    };
    categoryModel = { findOne: jest.fn() };
    brandModel = { findById: jest.fn(), findOne: jest.fn(), create: jest.fn() };
    compatibilityModel = { find: jest.fn(), insertMany: jest.fn().mockResolvedValue([]) };
    vehicleModel = { find: jest.fn() };

    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn(),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductCatalogImportService,
        { provide: MercadoLivreCompatibilityAdapter, useValue: mlCompatAdapter },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: getModelToken(CategoryModel.name), useValue: categoryModel },
        { provide: getModelToken(BrandModel.name), useValue: brandModel },
        { provide: getModelToken(ProductCompatibilityModel.name), useValue: compatibilityModel },
        { provide: getModelToken(VehicleCompatibilityModel.name), useValue: vehicleModel },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = moduleRef.get(ProductCatalogImportService);
  });

  describe('search', () => {
    it('mapeia candidatos do ML para o shape esperado', async () => {
      mlCompatAdapter.searchCatalogProductsByGtin.mockResolvedValue([
        {
          catalog_product_id: 'MLB1',
          name: 'Filtro Ar Motor',
          domain_id: 'MLB-VEHICLE_AIR_FILTERS',
          category_id: 'MLB47119',
          attributes: [{ id: 'BRAND', value_name: 'Tecfil' }],
          pictures: [{ url: 'http://img' }],
        },
      ]);

      const result = await service.search('7891342006217');

      expect(result.candidates).toEqual([
        {
          catalogProductId: 'MLB1',
          name: 'Filtro Ar Motor',
          domainId: 'MLB-VEHICLE_AIR_FILTERS',
          categoryId: 'MLB47119',
          brandName: 'Tecfil',
          thumbnail: 'http://img',
        },
      ]);
    });

    it('devolve lista vazia quando o ML não encontra nada', async () => {
      mlCompatAdapter.searchCatalogProductsByGtin.mockResolvedValue([]);

      const result = await service.search('0000000000000');

      expect(result.candidates).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('lança BadRequestException quando o catalog_product_id não existe', async () => {
      mlCompatAdapter.getCatalogProduct.mockResolvedValue(null);

      await expect(service.resolve('MLB999')).rejects.toThrow(BadRequestException);
    });

    it('monta o rascunho completo com atributos extras e posição (veículos desativados)', async () => {
      mlCompatAdapter.getCatalogProduct.mockResolvedValue({
        id: 'MLB1',
        name: 'Amortecedor Cofap GBL1252',
        category_id: 'MLB22709',
        pictures: [{ url: 'http://img1' }],
        attributes: [
          { id: 'BRAND', value_name: 'Cofap' },
          { id: 'PART_NUMBER', value_name: 'GBL1252' },
          { id: 'POSITION', value_id: '13701105', value_name: 'Traseira' },
          { id: 'SIDE_POSITION', value_id: '364128', value_name: 'Esquerdo' },
          { id: 'MATERIAL', value_name: 'Aço' },
        ],
      });
      categoryModel.findOne.mockReturnValue(mockLean({ _id: 'cat-rocket-1' }));

      const draft = await service.resolve('MLB1');

      // Resolução de veículos está desativada — nenhum endpoint ML confirmado para
      // catalog_product_id de peça → lista de veículos compatíveis. Ver comentário em
      // resolveVehicles() no service.
      expect(draft).toEqual({
        catalogProductId: 'MLB1',
        name: 'Amortecedor Cofap GBL1252',
        brandName: 'Cofap',
        partNumber: 'GBL1252',
        attributes: [{ id: 'MATERIAL', name: 'MATERIAL', value: 'Aço' }],
        images: ['http://img1'],
        suggestedCategoryId: 'cat-rocket-1',
        position: {
          position: '13701105',
          positionName: 'Traseira',
          sidePosition: '364128',
          sidePositionName: 'Esquerdo',
        },
        vehicleIds: [],
        vehiclesSkipped: 0,
      });
    });

    it('rascunho sem suggestedCategoryId quando nenhuma Category do Rocket mapeia o category_id', async () => {
      mlCompatAdapter.getCatalogProduct.mockResolvedValue({
        id: 'MLB1',
        name: 'Produto X',
        category_id: 'MLB999',
        attributes: [],
      });
      categoryModel.findOne.mockReturnValue(mockLean(null));

      const draft = await service.resolve('MLB1');

      expect(draft.suggestedCategoryId).toBeUndefined();
      expect(draft.position).toBeUndefined();
      expect(draft.vehicleIds).toEqual([]);
    });
  });

  describe('confirm', () => {
    it('cria produto novo + compatibilidades numa transação quando brandId já é conhecido', async () => {
      const newProductId = '507f1f77bcf86cd799439055';
      productModel.create.mockResolvedValue([{ _id: newProductId }]);
      brandModel.findById.mockReturnValue(mockSessionLean({ _id: 'brand1', name: 'Cofap' }));
      compatibilityModel.find.mockReturnValue(mockSelectSessionLean([]));
      vehicleModel.find.mockReturnValue(mockSessionLean([{ _id: 'v1', make: 'Fiat', model: 'Mobi', version: '1.0', mlVehicleId: 'veh1' }]));

      const result = await service.confirm({
        catalogProductId: 'MLB1',
        name: 'Amortecedor X',
        brandId: 'brand1',
        brandName: 'Cofap',
        partNumber: 'GBL1252',
        attributes: [],
        images: [],
        vehicleIds: ['v1'],
        vehiclesSkipped: 0,
      } as any);

      expect(result).toEqual({ productId: newProductId });
      expect(productModel.create).toHaveBeenCalled();
      expect(compatibilityModel.insertMany).toHaveBeenCalledWith(
        [expect.objectContaining({ vehicleId: 'v1', productId: newProductId })],
        { session },
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.abortTransaction).not.toHaveBeenCalled();
    });

    it('cria a marca automaticamente por nome quando brandId não é informado e a marca não existe', async () => {
      const newProductId = '507f1f77bcf86cd799439055';
      productModel.create.mockResolvedValue([{ _id: newProductId }]);
      brandModel.findOne.mockReturnValue(mockSessionLean(null));
      brandModel.create.mockResolvedValue([{ _id: 'newBrandId', name: 'Cofap' }]);
      compatibilityModel.find.mockReturnValue(mockSelectSessionLean([]));
      vehicleModel.find.mockReturnValue(mockSessionLean([]));

      const result = await service.confirm({
        catalogProductId: 'MLB1',
        name: 'Amortecedor X',
        brandName: 'Cofap',
        partNumber: 'GBL1252',
        attributes: [],
        images: [],
        vehicleIds: [],
        vehiclesSkipped: 0,
      } as any);

      expect(result).toEqual({ productId: newProductId });
      expect(brandModel.create).toHaveBeenCalledWith(
        [{ name: 'Cofap', active: true, isGenuine: false }],
        { session },
      );
      expect(productModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ brand: { _id: 'newBrandId', name: 'Cofap' } })],
        { session },
      );
    });

    it('reaproveita marca existente por nome (case-insensitive) sem criar duplicata', async () => {
      const newProductId = '507f1f77bcf86cd799439055';
      productModel.create.mockResolvedValue([{ _id: newProductId }]);
      brandModel.findOne.mockReturnValue(mockSessionLean({ _id: 'existingBrandId', name: 'Cofap' }));
      compatibilityModel.find.mockReturnValue(mockSelectSessionLean([]));
      vehicleModel.find.mockReturnValue(mockSessionLean([]));

      await service.confirm({
        catalogProductId: 'MLB1',
        name: 'Amortecedor X',
        brandName: 'cofap',
        partNumber: 'GBL1252',
        attributes: [],
        images: [],
        vehicleIds: [],
        vehiclesSkipped: 0,
      } as any);

      expect(brandModel.create).not.toHaveBeenCalled();
      expect(productModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ brand: { _id: 'existingBrandId', name: 'Cofap' } })],
        { session },
      );
    });

    it('lança BadRequestException quando não há brandId nem brandName', async () => {
      await expect(
        service.confirm({
          catalogProductId: 'MLB1',
          name: 'X',
          partNumber: 'P1',
          attributes: [],
          images: [],
          vehicleIds: [],
          vehiclesSkipped: 0,
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(session.abortTransaction).toHaveBeenCalled();
    });

    it('lança BadRequestException quando brandId informado não existe', async () => {
      brandModel.findById.mockReturnValue(mockSessionLean(null));

      await expect(
        service.confirm({
          catalogProductId: 'MLB1',
          name: 'X',
          brandId: 'ghost',
          partNumber: 'P1',
          attributes: [],
          images: [],
          vehicleIds: [],
          vehiclesSkipped: 0,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('enriquece produto existente sem sobrescrever campos já preenchidos', async () => {
      const existingProduct = {
        _id: 'prod1',
        images: [{ url: 'existing.jpg' }],
        attributes: [],
        category: undefined,
        save: jest.fn().mockResolvedValue(undefined),
      };
      productModel.findById.mockReturnValue({ session: () => ({ exec: () => Promise.resolve(existingProduct) }) });
      compatibilityModel.find.mockReturnValue(mockSelectSessionLean([]));
      vehicleModel.find.mockReturnValue(mockSessionLean([]));

      const result = await service.confirm({
        catalogProductId: 'MLB1',
        productId: 'prod1',
        name: 'Amortecedor X',
        attributes: [{ id: 'A', name: 'A', value: 'v' }],
        images: ['new.jpg'],
        suggestedCategoryId: '507f1f77bcf86cd799439099',
        vehicleIds: [],
        vehiclesSkipped: 0,
      } as any);

      expect(result).toEqual({ productId: 'prod1' });
      // images já existiam — não sobrescreve
      expect(existingProduct.images).toEqual([{ url: 'existing.jpg' }]);
      // attributes estava vazio — aplica
      expect(existingProduct.attributes).toEqual([{ name: 'A', value: 'v', code: 'A' }]);
      expect(existingProduct.save).toHaveBeenCalledWith({ session });
    });

    it('não duplica compatibilidade já vinculada ao produto', async () => {
      productModel.create.mockResolvedValue([{ _id: '507f1f77bcf86cd799439066' }]);
      brandModel.findById.mockReturnValue(mockSessionLean({ _id: 'brand1', name: 'Cofap' }));
      compatibilityModel.find.mockReturnValue(mockSelectSessionLean([{ vehicleId: 'v1' }]));
      vehicleModel.find.mockReturnValue(mockSessionLean([]));

      await service.confirm({
        catalogProductId: 'MLB1',
        name: 'X',
        brandId: 'brand1',
        partNumber: 'P1',
        attributes: [],
        images: [],
        vehicleIds: ['v1', 'v2'],
        vehiclesSkipped: 0,
      } as any);

      // só v2 deveria ter sido processado — v1 já linkado
      expect(vehicleModel.find).toHaveBeenCalledWith({ _id: { $in: ['v2'] } });
    });

    it('faz rollback (abortTransaction) quando algo falha no meio do processo', async () => {
      brandModel.findById.mockReturnValue(mockSessionLean({ _id: 'brand1', name: 'Cofap' }));
      productModel.create.mockRejectedValue(new Error('mongo down'));

      await expect(
        service.confirm({
          catalogProductId: 'MLB1',
          name: 'X',
          brandId: 'brand1',
          partNumber: 'P1',
          attributes: [],
          images: [],
          vehicleIds: [],
          vehiclesSkipped: 0,
        } as any),
      ).rejects.toThrow('mongo down');

      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });
  });
});
