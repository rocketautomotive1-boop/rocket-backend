import { Test, TestingModule } from '@nestjs/testing';
import { StockLedgerProvider } from './stock-ledger.provider';
import { StockService } from './stock.service';
import { STORE_OWNER_LOOKUP_PORT } from '../store-listing/ports/store-owner-lookup.port';
import { StockMovementType } from '../stock-shared/movement-type';

describe('StockLedgerProvider', () => {
  let provider: StockLedgerProvider;
  let stock: { move: jest.Mock };
  let storeOwnerLookup: { resolveStoreForSale: jest.Mock };

  const P1 = 'product-1';
  const STORE_A = 'store-a';

  beforeEach(async () => {
    stock = { move: jest.fn() };
    storeOwnerLookup = { resolveStoreForSale: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLedgerProvider,
        { provide: StockService, useValue: stock },
        { provide: STORE_OWNER_LOOKUP_PORT, useValue: storeOwnerLookup },
      ],
    }).compile();

    provider = module.get(StockLedgerProvider);
  });

  describe('deductAndLink', () => {
    it('resolves storeId from the product\'s existing StoreListing and passes it to move()', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: STORE_A, via: 'single' });
      stock.move.mockResolvedValue({ movementId: 'm1', lotId: 'l1' });

      const session: any = {};
      const result = await provider.deductAndLink('order-1', [{ productId: P1, quantity: 2 }], 'ref-1', 'ML', session);

      expect(stock.move).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A }),
        session,
      );
      expect(result.movementIds).toEqual(['m1']);
      expect(result.items).toEqual([{ productId: P1, quantity: 2 }]);
    });

    it('skips an item (without throwing, without a default-store fallback) when the product has no StoreListing', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: null, via: 'none' });

      const result = await provider.deductAndLink('order-1', [{ productId: P1, quantity: 2 }], 'ref-1', 'ML', {} as any);

      expect(stock.move).not.toHaveBeenCalled();
      expect(result.movementIds).toEqual([]);
      expect(result.items).toEqual([]);
    });
  });

  describe('revert', () => {
    it('resolves storeId per item before calling move()', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: STORE_A, via: 'single' });
      stock.move.mockResolvedValue({ movementId: 'm2', lotId: 'l2' });

      await provider.revert('order-1', [{ productId: P1, quantity: 1, unitPrice: 10 }], 'cancel:order-1');

      expect(stock.move).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A, type: StockMovementType.INBOUND }),
      );
    });
  });

  describe('deductStandalone', () => {
    it('resolves storeId per item before calling move()', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: STORE_A, via: 'single' });
      stock.move.mockResolvedValue({ movementId: 'm3', lotId: 'l3' });

      const result = await provider.deductStandalone('order-1', [{ productId: P1, quantity: 3 }], 'ref-2', 'Shopee');

      expect(stock.move).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A, type: StockMovementType.OUTBOUND }),
      );
      expect(result.movementsCount).toBe(1);
    });
  });

  describe('loja resolvida pelo anúncio vendido (incidente 7086768: baixa ia p/ a loja mais antiga)', () => {
    it('deductAndLink passa marketplaceId + externalId do anúncio ao lookup e baixa da loja devolvida', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: 'store-do-anuncio', via: 'listing' });
      stock.move.mockResolvedValue({ movementId: 'm1', lotId: 'l1' });

      await provider.deductAndLink(
        'order-1',
        [{ productId: P1, quantity: 5, marketplaceId: 'mkt-ml', listingExternalId: 'MLB7624411768' }],
        'ref-1', 'ML', {} as any,
      );

      expect(storeOwnerLookup.resolveStoreForSale).toHaveBeenCalledWith({
        productId: P1, marketplaceId: 'mkt-ml', listingExternalId: 'MLB7624411768',
      });
      expect(stock.move).toHaveBeenCalledWith(expect.objectContaining({ productId: P1, storeId: 'store-do-anuncio' }), expect.anything());
    });

    it('loja ambígua: NÃO baixa (nada de "mais antiga") e o item não consta em result.items', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: null, via: 'ambiguous' });

      const r = await provider.deductAndLink('order-1', [{ productId: P1, quantity: 1 }], 'ref-1', 'ML', {} as any);

      expect(stock.move).not.toHaveBeenCalled();
      expect(r.items).toEqual([]);
      expect(r.movementIds).toEqual([]);
    });

    it('revert devolve o estoque à loja do anúncio, não à mais antiga', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: 'store-do-anuncio', via: 'listing' });
      stock.move.mockResolvedValue({ movementId: 'm2', lotId: 'l2' });

      await provider.revert('order-1', [{ productId: P1, quantity: 1, unitPrice: 10, marketplaceId: 'mkt-ml', listingExternalId: 'MLB1' }], 'cancel:order-1');

      expect(stock.move).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-do-anuncio', type: StockMovementType.INBOUND }));
    });

    it('deductStandalone usa a mesma resolução por anúncio', async () => {
      storeOwnerLookup.resolveStoreForSale.mockResolvedValue({ storeId: 'store-do-anuncio', via: 'listing' });
      stock.move.mockResolvedValue({ movementId: 'm3', lotId: 'l3' });

      await provider.deductStandalone('order-1', [{ productId: P1, quantity: 1, marketplaceId: 'mkt-ml', listingExternalId: 'MLB1' }], 'ref', 'ML');

      expect(stock.move).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-do-anuncio', type: StockMovementType.OUTBOUND }));
    });
  });
});
