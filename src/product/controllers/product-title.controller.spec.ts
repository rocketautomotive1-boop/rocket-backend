import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductTitleController } from './product-title.controller';
import { ProductTitleService } from '../services/product-title.service';
import { ListingRemovalService } from '../../marketplace-orchestrator/services/listing-removal.service';

describe('ProductTitleController — isolamento por loja', () => {
  let controller: ProductTitleController;
  let service: {
    findByProductIdAndStore: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    updateTitles: jest.Mock;
  };
  let listingRemoval: { removeListing: jest.Mock };

  const STORE_A = 'store-a';
  const STORE_B = 'store-b';
  const reqWithStore = { user: { id: 'u1', storeId: STORE_A } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    service = {
      findByProductIdAndStore: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      updateTitles: jest.fn(),
    };
    listingRemoval = { removeListing: jest.fn() };
    controller = new ProductTitleController(
      service as unknown as ProductTitleService,
      listingRemoval as unknown as ListingRemovalService,
    );
  });

  describe('findAll', () => {
    it('resolve via findByProductIdAndStore usando o storeId do usuário', async () => {
      service.findByProductIdAndStore.mockResolvedValue([{ id: 't1' }]);

      const result = await controller.findAll('p1', reqWithStore);

      expect(service.findByProductIdAndStore).toHaveBeenCalledWith('p1', STORE_A);
      expect(result).toEqual([{ id: 't1' }]);
    });

    it('rejeita com 400 sem storeId', async () => {
      await expect(controller.findAll('p1', reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(service.findByProductIdAndStore).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('permite editar título da própria loja', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: STORE_A });
      service.update.mockResolvedValue({ id: 't1', title: 'Novo' });

      const result = await controller.update('t1', { title: 'Novo' } as any, reqWithStore);

      expect(service.update).toHaveBeenCalledWith('t1', { title: 'Novo' });
      expect(result).toEqual({ id: 't1', title: 'Novo' });
    });

    it('rejeita com 403 ao editar título de outra loja', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: STORE_B });

      await expect(controller.update('t1', { title: 'Novo' } as any, reqWithStore)).rejects.toThrow(ForbiddenException);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('rejeita com 403 quando o listing não tem storeId gravado (sem dono determinável)', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: undefined });

      await expect(controller.update('t1', { title: 'Novo' } as any, reqWithStore)).rejects.toThrow(ForbiddenException);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('rejeita com 400 sem storeId no usuário, antes de checar o listing', async () => {
      await expect(controller.update('t1', { title: 'Novo' } as any, reqWithoutStore)).rejects.toThrow(BadRequestException);
      expect(service.findOne).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('permite remover título não publicado da própria loja', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: STORE_A, externalId: null });
      service.remove.mockResolvedValue(true);

      const result = await controller.remove('t1', reqWithStore);

      expect(service.remove).toHaveBeenCalledWith('t1');
      expect(result.success).toBe(true);
    });

    it('rejeita com 403 ao remover título de outra loja, mesmo não publicado', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: STORE_B, externalId: null });

      await expect(controller.remove('t1', reqWithStore)).rejects.toThrow(ForbiddenException);
      expect(service.remove).not.toHaveBeenCalled();
      expect(listingRemoval.removeListing).not.toHaveBeenCalled();
    });

    it('rejeita com 403 ao remover título publicado de outra loja (checagem de dono antes da checagem de admin)', async () => {
      service.findOne.mockResolvedValue({ id: 't1', storeId: STORE_B, externalId: 'MLB1' });

      await expect(controller.remove('t1', { user: { id: 'u1', storeId: STORE_A, roles: ['admin'] } })).rejects.toThrow(
        ForbiddenException,
      );
      expect(listingRemoval.removeListing).not.toHaveBeenCalled();
    });
  });
});
