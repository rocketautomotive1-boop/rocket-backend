import { Test, TestingModule } from '@nestjs/testing';
import { StockLedgerProvider } from './stock-ledger.provider';
import { StockService } from './stock.service';
import { STORE_OWNER_LOOKUP_PORT } from '../store-listing/ports/store-owner-lookup.port';
import { StockMovementType } from './domain/movement-type';

describe('StockLedgerProvider', () => {
  let provider: StockLedgerProvider;
  let stock: { move: jest.Mock; mirrorMoveToLegacy: jest.Mock };
  let storeOwnerLookup: { findStoreIdByProduct: jest.Mock };

  const P1 = 'product-1';
  const STORE_A = 'store-a';

  beforeEach(async () => {
    stock = { move: jest.fn(), mirrorMoveToLegacy: jest.fn() };
    storeOwnerLookup = { findStoreIdByProduct: jest.fn() };

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
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
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
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);

      const result = await provider.deductAndLink('order-1', [{ productId: P1, quantity: 2 }], 'ref-1', 'ML', {} as any);

      expect(stock.move).not.toHaveBeenCalled();
      expect(result.movementIds).toEqual([]);
      expect(result.items).toEqual([]);
    });
  });

  describe('mirrorAfterCommit', () => {
    it('mirrors each deducted item using the resolved storeId, never throws on failure', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      stock.mirrorMoveToLegacy.mockRejectedValueOnce(new Error('boom'));

      await expect(
        provider.mirrorAfterCommit('order-1', [{ productId: P1, quantity: 2 }]),
      ).resolves.toBeUndefined();

      expect(stock.mirrorMoveToLegacy).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A, type: StockMovementType.OUTBOUND, quantity: 2 }),
      );
    });
  });

  describe('revert', () => {
    it('resolves storeId per item before calling move()', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      stock.move.mockResolvedValue({ movementId: 'm2', lotId: 'l2' });

      await provider.revert('order-1', [{ productId: P1, quantity: 1, unitPrice: 10 }], 'cancel:order-1');

      expect(stock.move).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A, type: StockMovementType.INBOUND }),
      );
    });
  });

  describe('deductStandalone', () => {
    it('resolves storeId per item before calling move()', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      stock.move.mockResolvedValue({ movementId: 'm3', lotId: 'l3' });

      const result = await provider.deductStandalone('order-1', [{ productId: P1, quantity: 3 }], 'ref-2', 'Shopee');

      expect(stock.move).toHaveBeenCalledWith(
        expect.objectContaining({ productId: P1, storeId: STORE_A, type: StockMovementType.OUTBOUND }),
      );
      expect(result.movementsCount).toBe(1);
    });
  });
});
