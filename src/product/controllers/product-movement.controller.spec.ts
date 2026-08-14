import { BadRequestException } from '@nestjs/common';
import { ProductMovementController } from './product-movement.controller';
import { StockService } from '../../stock/stock.service';
import { StockQueryService } from '../../stock/stock-query.service';

describe('ProductMovementController', () => {
  let controller: ProductMovementController;
  let stock: { move: jest.Mock; editMovementViaAdjustment: jest.Mock; reverseMovement: jest.Mock };

  const reqWithStore = { user: { id: 'u1', storeId: 'store-maxeshop' } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    stock = { move: jest.fn(), editMovementViaAdjustment: jest.fn(), reverseMovement: jest.fn() };
    controller = new ProductMovementController(stock as unknown as StockService, {} as StockQueryService);
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
});
