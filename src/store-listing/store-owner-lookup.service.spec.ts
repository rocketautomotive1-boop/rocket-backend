import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StoreOwnerLookupService } from './store-owner-lookup.service';
import { StoreListingModel } from './schemas/store-listing.schema';
import { ListingModel } from '../listing/schemas/listing.schema';

describe('StoreOwnerLookupService', () => {
    let service: StoreOwnerLookupService;
    let storeListingModel: { findOne: jest.Mock; countDocuments: jest.Mock; find: jest.Mock };
    let listingModel: { findOne: jest.Mock };

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
