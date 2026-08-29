import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StoreOwnerLookupService } from './store-owner-lookup.service';
import { StoreListingModel } from './schemas/store-listing.schema';

describe('StoreOwnerLookupService', () => {
    let service: StoreOwnerLookupService;
    let storeListingModel: { findOne: jest.Mock };

    beforeEach(async () => {
        storeListingModel = { findOne: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                StoreOwnerLookupService,
                { provide: getModelToken(StoreListingModel.name), useValue: storeListingModel },
            ],
        }).compile();

        service = module.get(StoreOwnerLookupService);
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

        const result = await service.findStoreIdByProduct('product-sem-listing');

        expect(result).toBeNull();
    });
});
