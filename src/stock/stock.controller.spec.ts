import { BadRequestException } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockService } from './stock.service';
import { StoreListingPort } from '../store-listing/ports/store-listing.port';

describe('StockController', () => {
  let controller: StockController;
  let stock: { correctTo: jest.Mock };
  let storeListingPort: {
    getStockSummary: jest.Mock;
    getStockByCondition: jest.Mock;
    getStockByLocation: jest.Mock;
  };

  const reqWithStore = { user: { id: 'u1', storeId: 'store-maxeshop' } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    stock = { correctTo: jest.fn() };
    storeListingPort = {
      getStockSummary: jest.fn(),
      getStockByCondition: jest.fn(),
      getStockByLocation: jest.fn(),
    };
    controller = new StockController(
      {} as StockReconcilerService,
      stock as unknown as StockService,
      storeListingPort as unknown as StoreListingPort,
    );
  });

  describe('balance', () => {
    it('resolve o saldo via STORE_LISTING_PORT usando o storeId do usuário logado', async () => {
      storeListingPort.getStockSummary.mockResolvedValue({ onHand: 5, reserved: 1, available: 4, avgCost: 10 });

      const result = await controller.balance('p1', reqWithStore);

      expect(storeListingPort.getStockSummary).toHaveBeenCalledWith('p1', 'store-maxeshop');
      expect(result).toEqual({ productId: 'p1', onHand: 5, reserved: 1, available: 4, avgCost: 10 });
    });

    it('rejeita com 400 quando o usuário não tem loja configurada', async () => {
      await expect(controller.balance('p1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(storeListingPort.getStockSummary).not.toHaveBeenCalled();
    });
  });

  describe('byCondition', () => {
    it('resolve via STORE_LISTING_PORT com o storeId do usuário', async () => {
      storeListingPort.getStockByCondition.mockResolvedValue([{ condition: 'new', onHand: 5, reserved: 0 }]);

      await controller.byCondition('p1', reqWithStore);

      expect(storeListingPort.getStockByCondition).toHaveBeenCalledWith('p1', 'store-maxeshop');
    });

    it('rejeita com 400 sem storeId', () => {
      expect(() => controller.byCondition('p1', reqWithoutStore)).toThrow(BadRequestException);
    });
  });

  describe('byLocation', () => {
    it('resolve via STORE_LISTING_PORT com o storeId do usuário', async () => {
      storeListingPort.getStockByLocation.mockResolvedValue([{ boxId: null, onHand: 5, reserved: 0 }]);

      await controller.byLocation('p1', reqWithStore);

      expect(storeListingPort.getStockByLocation).toHaveBeenCalledWith('p1', 'store-maxeshop');
    });

    it('rejeita com 400 sem storeId', () => {
      expect(() => controller.byLocation('p1', reqWithoutStore)).toThrow(BadRequestException);
    });
  });

  describe('correctTo', () => {
    it('propaga req.user.storeId pra StockService.correctTo', async () => {
      stock.correctTo.mockResolvedValue({ movementId: 'm1', lotId: 'l1' });

      await controller.correctTo('p1', { quantity: 10 }, reqWithStore);

      expect(stock.correctTo).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'p1', storeId: 'store-maxeshop', targetQuantity: 10 }),
      );
    });

    it('rejeita com 400 quando o usuário não tem loja configurada, antes de chamar o service', async () => {
      await expect(controller.correctTo('p1', { quantity: 10 }, reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(stock.correctTo).not.toHaveBeenCalled();
    });

    it('rejeita com 400 quando quantity é inválida, antes de checar storeId', async () => {
      await expect(controller.correctTo('p1', { quantity: -1 }, reqWithStore)).rejects.toThrow(BadRequestException);
      expect(stock.correctTo).not.toHaveBeenCalled();
    });
  });
});
