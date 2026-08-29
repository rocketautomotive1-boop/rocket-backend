import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StoreOwnerLookupService } from './store-owner-lookup.service';
import { StoreListingModel } from './schemas/store-listing.schema';

describe('StoreOwnerLookupService', () => {
    let service: StoreOwnerLookupService;
    let storeListingModel: { findOne: jest.Mock; countDocuments: jest.Mock };
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
        storeListingModel = { findOne: jest.fn(), countDocuments: jest.fn().mockResolvedValue(1) };

        const module = await Test.createTestingModule({
            providers: [
                StoreOwnerLookupService,
                { provide: getModelToken(StoreListingModel.name), useValue: storeListingModel },
            ],
        }).compile();

        service = module.get(StoreOwnerLookupService);
        warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
    });

    it('retorna o storeId da StoreListing mais antiga do produto', async () => {
        storeListingModel.findOne.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue({ storeId: { toString: () => 'store-1' } }),
        });

        const result = await service.findStoreIdByProduct('product-1');

        expect(result).toBe('store-1');
        expect(storeListingModel.findOne).toHaveBeenCalledWith({ productId: 'product-1' });
    });

    it('retorna null quando o produto não tem StoreListing', async () => {
        storeListingModel.findOne.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null),
        });
        storeListingModel.countDocuments.mockResolvedValue(0);

        const result = await service.findStoreIdByProduct('product-sem-listing');

        expect(result).toBeNull();
    });

    it('não loga warning quando o produto tem exatamente 1 StoreListing (caso normal hoje)', async () => {
        storeListingModel.findOne.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue({ storeId: { toString: () => 'store-1' } }),
        });
        storeListingModel.countDocuments.mockResolvedValue(1);

        await service.findStoreIdByProduct('product-1');

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('loga warning quando o produto tem MAIS de uma StoreListing (resolução "primeira loja" pode estar errada)', async () => {
        storeListingModel.findOne.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue({ storeId: { toString: () => 'store-1' } }),
        });
        storeListingModel.countDocuments.mockResolvedValue(2);

        const result = await service.findStoreIdByProduct('product-multi-loja');

        expect(result).toBe('store-1');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('product-multi-loja'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2'));
    });
});
