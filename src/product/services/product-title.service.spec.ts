import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductModel } from '../schemas/product.schema';
import { ProductTitleService } from './product-title.service';
import { ListingService } from '../../listing/listing.service';

describe('ProductTitleService — isolamento por loja', () => {
  let service: ProductTitleService;
  let productModelMock: any;
  let listingServiceMock: any;
  let eventEmitterMock: any;

  const PRODUCT_ID = new Types.ObjectId().toHexString();
  const STORE_A = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    productModelMock = {
      findOne: jest.fn().mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: PRODUCT_ID }) }) }),
    };
    listingServiceMock = {
      findByProduct: jest.fn(),
      findByProductAndStore: jest.fn(),
      findById: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    eventEmitterMock = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductTitleService,
        { provide: getModelToken(ProductModel.name), useValue: productModelMock },
        { provide: ListingService, useValue: listingServiceMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
      ],
    }).compile();

    service = moduleRef.get(ProductTitleService);
  });

  describe('findByProductIdAndStore', () => {
    it('delega para ListingService.findByProductAndStore, não findByProduct', async () => {
      listingServiceMock.findByProductAndStore.mockResolvedValue([
        { _id: 'L1', title: 'X', marketplaceId: new Types.ObjectId(), storeId: new Types.ObjectId(STORE_A) },
      ]);

      const result = await service.findByProductIdAndStore(PRODUCT_ID, STORE_A);

      expect(listingServiceMock.findByProductAndStore).toHaveBeenCalledWith(PRODUCT_ID, STORE_A);
      expect(listingServiceMock.findByProduct).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].storeId).toBe(STORE_A);
    });
  });

  describe('updateTitles — regressão: batch de uma loja não apaga listings de outra', () => {
    it('usa findByProductAndStore para decidir o que deletar, não findByProduct', async () => {
      // Loja A tem 1 listing existente que NÃO virá no payload do batch abaixo — se o service
      // usasse findByProduct (sem filtro), esse listing de OUTRA loja seria apagado por engano.
      listingServiceMock.findByProductAndStore.mockResolvedValue([]); // nada da loja do usuário
      listingServiceMock.create.mockResolvedValue({ _id: 'NEW1', title: 'Novo', marketplaceId: new Types.ObjectId() });

      await service.updateTitles(
        PRODUCT_ID,
        [{ title: 'Novo', marketplaceId: new Types.ObjectId().toHexString() }],
        1,
        STORE_A,
      );

      expect(listingServiceMock.findByProductAndStore).toHaveBeenCalledWith(expect.anything(), expect.anything());
      expect(listingServiceMock.findByProduct).not.toHaveBeenCalled();
      expect(listingServiceMock.delete).not.toHaveBeenCalled();
    });

    it('sem storeId, não deleta nada (existingListings vazio por segurança, não findByProduct)', async () => {
      listingServiceMock.create.mockResolvedValue({ _id: 'NEW1', title: 'Novo', marketplaceId: new Types.ObjectId() });

      await service.updateTitles(
        PRODUCT_ID,
        [{ title: 'Novo', marketplaceId: new Types.ObjectId().toHexString() }],
        1,
        null,
      );

      expect(listingServiceMock.findByProduct).not.toHaveBeenCalled();
      expect(listingServiceMock.findByProductAndStore).not.toHaveBeenCalled();
      expect(listingServiceMock.delete).not.toHaveBeenCalled();
    });
  });
});
