import { BadRequestException } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StoreAwareStockQueryPort } from './ports/stock-query.port';

describe('StockController', () => {
  let controller: StockController;
  let stock: { correctTo: jest.Mock };
  let stockQuery: {
    getStoreStockSummary: jest.Mock;
    getStoreStockByCondition: jest.Mock;
    getStoreStockByLocation: jest.Mock;
  };

  const reqWithStore = { user: { id: 'u1', storeId: 'store-maxeshop' } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    stock = { correctTo: jest.fn() };
    stockQuery = {
      getStoreStockSummary: jest.fn(),
      getStoreStockByCondition: jest.fn(),
      getStoreStockByLocation: jest.fn(),
    };
    controller = new StockController(
      stock as unknown as StockService,
      stockQuery as unknown as StoreAwareStockQueryPort,
    );
  });

  describe('balance', () => {
    it('resolve o saldo via STOCK_QUERY_PORT usando o storeId do usuário logado', async () => {
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 5, reserved: 1, available: 4, avgCost: 10 });

      const result = await controller.balance('p1', reqWithStore);

      expect(stockQuery.getStoreStockSummary).toHaveBeenCalledWith('p1', 'store-maxeshop');
      expect(result).toEqual({ productId: 'p1', onHand: 5, reserved: 1, available: 4, avgCost: 10 });
    });

    it('rejeita com 400 quando o usuário não tem loja configurada', async () => {
      await expect(controller.balance('p1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(stockQuery.getStoreStockSummary).not.toHaveBeenCalled();
    });
  });

  describe('byCondition', () => {
    it('resolve via STOCK_QUERY_PORT com o storeId do usuário', async () => {
      stockQuery.getStoreStockByCondition.mockResolvedValue([{ condition: 'new', onHand: 5, reserved: 0 }]);

      await controller.byCondition('p1', reqWithStore);

      expect(stockQuery.getStoreStockByCondition).toHaveBeenCalledWith('p1', 'store-maxeshop');
    });

    it('rejeita com 400 sem storeId', () => {
      expect(() => controller.byCondition('p1', reqWithoutStore)).toThrow(BadRequestException);
    });
  });

  describe('byLocation', () => {
    it('resolve via STOCK_QUERY_PORT com o storeId do usuário', async () => {
      stockQuery.getStoreStockByLocation.mockResolvedValue([{ boxId: null, onHand: 5, reserved: 0 }]);

      await controller.byLocation('p1', reqWithStore);

      expect(stockQuery.getStoreStockByLocation).toHaveBeenCalledWith('p1', 'store-maxeshop');
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
