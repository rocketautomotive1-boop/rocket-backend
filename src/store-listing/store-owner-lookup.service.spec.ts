import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StoreOwnerLookupService } from './store-owner-lookup.service';
import { StoreListingModel } from './schemas/store-listing.schema';
import { ListingModel } from '../listing/schemas/listing.schema';

describe('StoreOwnerLookupService', () => {
    let service: StoreOwnerLookupService;
    let storeListingModel: { findOne: jest.Mock; countDocuments: jest.Mock; find: jest.Mock };
    let listingModel: { findOne: jest.Mock };
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
        storeListingModel = { findOne: jest.fn(), countDocuments: jest.fn().mockResolvedValue(1), find: jest.fn() };
        listingModel = { findOne: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                StoreOwnerLookupService,
                { provide: getModelToken(StoreListingModel.name), useValue: storeListingModel },
                { provide: getModelToken(ListingModel.name), useValue: listingModel },
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

    describe('resolveStoreForSale (loja = a do anúncio que vendeu, nunca "a mais antiga")', () => {
        const chain = (value: any) => ({
            select: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(value),
        });

        it('usa a loja do Listing vendido mesmo quando o produto tem outra StoreListing mais antiga', async () => {
            listingModel.findOne.mockReturnValue(chain({ storeId: 'store-novo' }));
            storeListingModel.find.mockReturnValue(chain([{ storeId: 'store-antigo' }, { storeId: 'store-novo' }]));

            const r = await service.resolveStoreForSale({ productId: 'p1', marketplaceId: 'm1', listingExternalId: 'MLB1' });

            expect(r).toEqual({ storeId: 'store-novo', via: 'listing' });
            expect(listingModel.findOne).toHaveBeenCalledWith({ marketplaceId: 'm1', externalId: 'MLB1', productId: 'p1' });
        });

        it('sem anúncio resolvido, produto com UMA loja usa essa loja', async () => {
            listingModel.findOne.mockReturnValue(chain(null));
            storeListingModel.find.mockReturnValue(chain([{ storeId: 'store-unica' }]));

            const r = await service.resolveStoreForSale({ productId: 'p1', marketplaceId: 'm1', listingExternalId: 'MLB-desconhecido' });

            expect(r).toEqual({ storeId: 'store-unica', via: 'single' });
        });

        it('sem anúncio resolvido e MAIS de uma loja: NÃO adivinha — devolve ambiguous com storeId null', async () => {
            listingModel.findOne.mockReturnValue(chain(null));
            storeListingModel.find.mockReturnValue(chain([{ storeId: 'a' }, { storeId: 'b' }]));

            const r = await service.resolveStoreForSale({ productId: 'p1', marketplaceId: 'm1', listingExternalId: 'MLB-x' });

            expect(r).toEqual({ storeId: null, via: 'ambiguous' });
        });

        it('sem dados do anúncio (chamador legado) e produto multi-loja também é ambíguo', async () => {
            storeListingModel.find.mockReturnValue(chain([{ storeId: 'a' }, { storeId: 'b' }]));

            const r = await service.resolveStoreForSale({ productId: 'p1' });

            expect(listingModel.findOne).not.toHaveBeenCalled();
            expect(r).toEqual({ storeId: null, via: 'ambiguous' });
        });

        it('produto sem nenhuma StoreListing devolve none', async () => {
            listingModel.findOne.mockReturnValue(chain(null));
            storeListingModel.find.mockReturnValue(chain([]));

            expect(await service.resolveStoreForSale({ productId: 'p1', marketplaceId: 'm1', listingExternalId: 'MLB1' }))
                .toEqual({ storeId: null, via: 'none' });
        });
    });
});
