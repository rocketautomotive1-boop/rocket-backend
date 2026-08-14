import { BadRequestException, ForbiddenException } from '@nestjs/common';

// uuid é ESM-only e quebra o parser do Jest — ProductController importa
// ProductDiscoveryService, que importa uuid, transitivamente. Mock antes do import
// real (mesmo padrão usado em outros specs deste módulo que tocam essa cadeia).
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductTitleService } from './services/product-title.service';

/**
 * Regressão: GET/POST/PUT :id/titles neste controller são um caminho PARALELO ao
 * ProductTitleController (/titles) — ambos existem, ambos são usados pelo frontend (a tela de
 * Títulos usa ESTE controller, via GET/POST /products/:id/titles). Isolar só o outro controller
 * deixava este sem storeId, mostrando/editando títulos de outra loja.
 */
describe('ProductController — títulos isolados por loja', () => {
  let controller: ProductController;
  let productService: { findOne: jest.Mock; updateTitles: jest.Mock; updateTitle: jest.Mock };
  let productTitleService: { findByProductIdAndStore: jest.Mock; findById: jest.Mock };

  const STORE_A = 'store-a';
  const STORE_B = 'store-b';
  const reqWithStore = { user: { id: 'u1', storeId: STORE_A } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    productService = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }), updateTitles: jest.fn(), updateTitle: jest.fn() };
    productTitleService = { findByProductIdAndStore: jest.fn(), findById: jest.fn() };
    controller = Object.create(ProductController.prototype) as ProductController;
    (controller as any).productService = productService;
    (controller as any).productTitleService = productTitleService;
  });

  describe('getTitles (GET :id/titles)', () => {
    it('resolve via findByProductIdAndStore usando o storeId do usuário', async () => {
      productTitleService.findByProductIdAndStore.mockResolvedValue([{ id: 't1' }]);

      const result = await controller.getTitles('p1', reqWithStore);

      expect(productTitleService.findByProductIdAndStore).toHaveBeenCalledWith('p1', STORE_A);
      expect(result).toEqual([{ id: 't1' }]);
    });

    it('rejeita com 400 sem storeId', async () => {
      await expect(controller.getTitles('p1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(productTitleService.findByProductIdAndStore).not.toHaveBeenCalled();
    });
  });

  describe('updateTitles (POST :id/titles)', () => {
    it('propaga storeId do usuário para ProductService.updateTitles', async () => {
      productService.updateTitles.mockResolvedValue({ id: 'p1' });

      await controller.updateTitles('p1', { titles: [{ title: 'X', marketplaceId: 'm1' }] }, reqWithStore);

      expect(productService.updateTitles).toHaveBeenCalledWith(
        'p1',
        [{ title: 'X', marketplaceId: 'm1' }],
        'u1',
        STORE_A,
      );
    });

    it('rejeita com 400 sem storeId, antes de chamar o service', async () => {
      await expect(
        controller.updateTitles('p1', { titles: [{ title: 'X', marketplaceId: 'm1' }] }, reqWithoutStore),
      ).rejects.toThrow(BadRequestException);
      expect(productService.updateTitles).not.toHaveBeenCalled();
    });
  });

  describe('updateTitle (PUT :id/titles/:titleId)', () => {
    it('permite editar título da própria loja', async () => {
      productTitleService.findById.mockResolvedValue({ id: 't1', storeId: STORE_A });
      productService.updateTitle.mockResolvedValue({ id: 'p1' });

      await controller.updateTitle('p1', 't1', { title: 'Novo' }, reqWithStore);

      expect(productService.updateTitle).toHaveBeenCalledWith('p1', 't1', { title: 'Novo' });
    });

    it('rejeita com 403 ao editar título de outra loja', async () => {
      productTitleService.findById.mockResolvedValue({ id: 't1', storeId: STORE_B });

      await expect(controller.updateTitle('p1', 't1', { title: 'Novo' }, reqWithStore)).rejects.toThrow(
        ForbiddenException,
      );
      expect(productService.updateTitle).not.toHaveBeenCalled();
    });

    it('rejeita com 403 quando o título não tem storeId gravado (sem dono determinável)', async () => {
      productTitleService.findById.mockResolvedValue({ id: 't1', storeId: undefined });

      await expect(controller.updateTitle('p1', 't1', { title: 'Novo' }, reqWithStore)).rejects.toThrow(
        ForbiddenException,
      );
      expect(productService.updateTitle).not.toHaveBeenCalled();
    });

    it('rejeita com 400 sem storeId no usuário, antes de checar o título', async () => {
      await expect(controller.updateTitle('p1', 't1', { title: 'Novo' }, reqWithoutStore)).rejects.toThrow(
        BadRequestException,
      );
      expect(productTitleService.findById).not.toHaveBeenCalled();
    });
  });
});
