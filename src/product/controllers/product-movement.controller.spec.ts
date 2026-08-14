import { BadRequestException } from '@nestjs/common';
import { ProductMovementController } from './product-movement.controller';
import { StockService } from '../../stock/stock.service';
import { StoreListingPort } from '../../store-listing/ports/store-listing.port';

describe('ProductMovementController', () => {
  let controller: ProductMovementController;
  let stock: { move: jest.Mock; editMovementViaAdjustment: jest.Mock; reverseMovement: jest.Mock };
  let storeListingPort: { listStockMovements: jest.Mock; getStockMovementStatistics: jest.Mock };

  const reqWithStore = { user: { id: 'u1', storeId: 'store-maxeshop' } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    stock = { move: jest.fn(), editMovementViaAdjustment: jest.fn(), reverseMovement: jest.fn() };
    storeListingPort = { listStockMovements: jest.fn(), getStockMovementStatistics: jest.fn() };
    controller = new ProductMovementController(
      stock as unknown as StockService,
      storeListingPort as unknown as StoreListingPort,
    );
  });

  describe('create', () => {
    it('propaga req.user.storeId pra StockService.move', async () => {
      stock.move.mockResolvedValue({ movementId: 'm1', lotId: 'l1' });

      await controller.create({ productId: 'p1', quantity: 5 } as any, reqWithStore);

      expect(stock.move).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-maxeshop' }));
    });

    it('rejeita com 400 explícito quando o usuário não tem loja configurada', async () => {
      await expect(
        controller.create({ productId: 'p1', quantity: 5 } as any, reqWithoutStore),
      ).rejects.toThrow(BadRequestException);
      expect(stock.move).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('propaga storeId como fallback pra editMovementViaAdjustment', async () => {
      stock.editMovementViaAdjustment.mockResolvedValue({ movementId: 'm1', lotId: 'l1' });

      await controller.update('mov1', { quantity: 3 } as any, reqWithStore);

      expect(stock.editMovementViaAdjustment).toHaveBeenCalledWith('mov1', 3, 'store-maxeshop');
    });

    it('rejeita com 400 quando não há loja, antes de chamar o service', async () => {
      await expect(
        controller.update('mov1', { quantity: 3 } as any, reqWithoutStore),
      ).rejects.toThrow(BadRequestException);
      expect(stock.editMovementViaAdjustment).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('propaga storeId como fallback pra reverseMovement', async () => {
      stock.reverseMovement.mockResolvedValue({ movementId: 'm2', lotId: 'l2' });

      await controller.remove('mov1', reqWithStore);

      expect(stock.reverseMovement).toHaveBeenCalledWith('mov1', 'store-maxeshop');
    });

    it('rejeita com 400 quando não há loja, antes de chamar o service', async () => {
      await expect(controller.remove('mov1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(stock.reverseMovement).not.toHaveBeenCalled();
    });
  });

  describe('findAll / findByProduct / getStatistics (leitura store-aware)', () => {
    it('findAll resolve via STORE_LISTING_PORT usando o storeId do usuário logado', async () => {
      storeListingPort.listStockMovements.mockResolvedValue([{ id: 'm1' }]);

      const result = await controller.findAll('p1', reqWithStore);

      expect(storeListingPort.listStockMovements).toHaveBeenCalledWith('p1', 'store-maxeshop', 200);
      expect(result).toEqual([{ id: 'm1' }]);
    });

    it('findAll retorna [] sem consultar quando productId não é informado', async () => {
      const result = await controller.findAll(undefined, reqWithStore);
      expect(result).toEqual([]);
      expect(storeListingPort.listStockMovements).not.toHaveBeenCalled();
    });

    it('findByProduct resolve via STORE_LISTING_PORT usando o storeId do usuário logado', async () => {
      storeListingPort.listStockMovements.mockResolvedValue([{ id: 'm2' }]);

      await controller.findByProduct('p1', reqWithStore);

      expect(storeListingPort.listStockMovements).toHaveBeenCalledWith('p1', 'store-maxeshop', 200);
    });

    it('findByProduct rejeita com 400 sem storeId', async () => {
      await expect(controller.findByProduct('p1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(storeListingPort.listStockMovements).not.toHaveBeenCalled();
    });

    it('getStatistics resolve via STORE_LISTING_PORT usando o storeId do usuário logado', async () => {
      storeListingPort.getStockMovementStatistics.mockResolvedValue({ inbound: { count: 1, quantity: 5 } });

      const result = await controller.getStatistics('p1', reqWithStore);

      expect(storeListingPort.getStockMovementStatistics).toHaveBeenCalledWith('p1', 'store-maxeshop');
      expect(result).toEqual({ inbound: { count: 1, quantity: 5 } });
    });

    it('getStatistics retorna {} sem consultar quando productId não é informado', async () => {
      const result = await controller.getStatistics(undefined, reqWithStore);
      expect(result).toEqual({});
      expect(storeListingPort.getStockMovementStatistics).not.toHaveBeenCalled();
    });
  });
});
