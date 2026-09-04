import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductDeletionService } from './product-deletion.service';

describe('ProductDeletionService', () => {
  let service: ProductDeletionService;
  let productModel: {
    findById: jest.Mock;
    updateOne: jest.Mock;
    deleteOne: jest.Mock;
  };
  let orderModel: { countDocuments: jest.Mock };
  let allocationModel: { findOne: jest.Mock };
  let listingService: {
    findByProduct: jest.Mock;
    delete: jest.Mock;
    deleteByProduct: jest.Mock;
  };
  let listingRemoval: { removeListing: jest.Mock };
  let events: { emit: jest.Mock };

  const productId = new Types.ObjectId().toString();
  const requesterId = new Types.ObjectId().toString();

  function makeListing(overrides: any = {}) {
    return {
      _id: new Types.ObjectId(),
      productId: new Types.ObjectId(productId),
      marketplaceId: new Types.ObjectId(),
      externalId: 'MLB123',
      ...overrides,
    };
  }

  function mockExec(value: any) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  beforeEach(() => {
    productModel = {
      findById: jest.fn(),
      updateOne: jest.fn().mockReturnValue(mockExec({})),
      deleteOne: jest.fn().mockReturnValue(mockExec({})),
    };
    orderModel = { countDocuments: jest.fn().mockReturnValue(mockExec(0)) };
    allocationModel = { findOne: jest.fn().mockReturnValue(mockExec(null)) };
    listingService = {
      findByProduct: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      deleteByProduct: jest.fn().mockResolvedValue(undefined),
    };
    listingRemoval = { removeListing: jest.fn().mockResolvedValue({ queued: true }) };
    events = { emit: jest.fn() };

    service = new ProductDeletionService(
      productModel as any,
      orderModel as any,
      allocationModel as any,
      listingService as any,
      listingRemoval as any,
      events as any,
    );
  });

  describe('requestDeletion — guard rails', () => {
    it('lança NotFoundException se o produto não existe', async () => {
      productModel.findById.mockReturnValue(mockExec(null));
      await expect(service.requestDeletion(productId)).rejects.toThrow(NotFoundException);
    });

    it('lança ConflictException se já está pending', async () => {
      productModel.findById.mockReturnValue(mockExec({ deletionStatus: 'pending' }));
      await expect(service.requestDeletion(productId)).rejects.toThrow(ConflictException);
    });

    it('bloqueia se houver pedido referenciando o produto', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      orderModel.countDocuments.mockReturnValue(mockExec(2));
      await expect(service.requestDeletion(productId)).rejects.toThrow(BadRequestException);
      expect(listingService.findByProduct).not.toHaveBeenCalled();
    });

    it('bloqueia se o produto estiver alocado em alguma caixa', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      allocationModel.findOne.mockReturnValue(mockExec({ _id: 'alloc1' }));
      await expect(service.requestDeletion(productId)).rejects.toThrow(BadRequestException);
      expect(listingService.findByProduct).not.toHaveBeenCalled();
    });
  });

  describe('requestDeletion — sem listings publicados (atalho síncrono)', () => {
    it('apaga listings sem externalId e finaliza no mesmo request', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      const l1 = makeListing({ externalId: undefined });
      listingService.findByProduct.mockResolvedValue([l1]);

      const result = await service.requestDeletion(productId, requesterId);

      expect(listingService.delete).toHaveBeenCalledWith(String(l1._id));
      expect(listingRemoval.removeListing).not.toHaveBeenCalled();
      expect(listingService.deleteByProduct).toHaveBeenCalledWith(productId);
      expect(productModel.deleteOne).toHaveBeenCalledWith({ _id: productId });
      expect(events.emit).toHaveBeenCalledWith(
        'notification.requested',
        expect.objectContaining({ type: 'product.deleted' }),
      );
      expect(result).toEqual({ deletionStatus: 'completed', pendingMarketplaces: [] });
    });

    it('sem nenhum listing, finaliza direto', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      listingService.findByProduct.mockResolvedValue([]);

      const result = await service.requestDeletion(productId);

      expect(productModel.deleteOne).toHaveBeenCalled();
      expect(result.deletionStatus).toBe('completed');
    });
  });

  describe('requestDeletion — com listings publicados (fluxo assíncrono)', () => {
    it('enfileira DELETE por listing publicado e marca deletionStatus=pending', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      const published = makeListing({ externalId: 'MLB123' });
      listingService.findByProduct.mockResolvedValue([published]);

      const result = await service.requestDeletion(productId, requesterId);

      expect(listingRemoval.removeListing).toHaveBeenCalledWith(String(published._id), requesterId);
      expect(productModel.deleteOne).not.toHaveBeenCalled();
      expect(productModel.updateOne).toHaveBeenCalledWith(
        { _id: productId },
        expect.objectContaining({
          $set: expect.objectContaining({ deletionStatus: 'pending' }),
        }),
      );
      expect(result.deletionStatus).toBe('pending');
      expect(result.pendingMarketplaces).toHaveLength(1);
    });

    it('mistura listings com e sem externalId — apaga os sem externalId, enfileira os com', async () => {
      productModel.findById.mockReturnValue(mockExec({}));
      const unpublished = makeListing({ externalId: undefined });
      const published = makeListing({ externalId: 'MLB999' });
      listingService.findByProduct.mockResolvedValue([unpublished, published]);

      await service.requestDeletion(productId);

      expect(listingService.delete).toHaveBeenCalledWith(String(unpublished._id));
      expect(listingRemoval.removeListing).toHaveBeenCalledWith(String(published._id), undefined);
    });
  });

  describe('onListingRemovalResult', () => {
    it('no-op se o produto não está em deletionStatus=pending', async () => {
      productModel.findById.mockReturnValue(mockExec({ deletionStatus: undefined }));
      await service.onListingRemovalResult(productId, 'listing1', true);
      expect(productModel.updateOne).not.toHaveBeenCalled();
      expect(productModel.deleteOne).not.toHaveBeenCalled();
    });

    it('marca deletionStatus=failed quando o resultado é falha', async () => {
      const listingId = new Types.ObjectId();
      productModel.findById.mockReturnValue(
        mockExec({ deletionStatus: 'pending', deletionPendingListingIds: [listingId] }),
      );

      await service.onListingRemovalResult(productId, String(listingId), false);

      expect(productModel.updateOne).toHaveBeenCalledWith(
        { _id: productId },
        expect.objectContaining({
          $set: expect.objectContaining({ deletionStatus: 'failed' }),
        }),
      );
      expect(productModel.deleteOne).not.toHaveBeenCalled();
    });

    it('mantém pending se ainda há outros listings pendentes', async () => {
      const listingId1 = new Types.ObjectId();
      const listingId2 = new Types.ObjectId();
      productModel.findById.mockReturnValue(
        mockExec({ deletionStatus: 'pending', deletionPendingListingIds: [listingId1, listingId2] }),
      );

      await service.onListingRemovalResult(productId, String(listingId1), true);

      expect(productModel.updateOne).toHaveBeenCalledWith(
        { _id: productId },
        { $set: { deletionPendingListingIds: [listingId2] } },
      );
      expect(productModel.deleteOne).not.toHaveBeenCalled();
    });

    it('finaliza (stock+listings+product) quando o último listing pendente confirma sucesso', async () => {
      const listingId1 = new Types.ObjectId();
      productModel.findById.mockReturnValue(
        mockExec({ deletionStatus: 'pending', deletionPendingListingIds: [listingId1] }),
      );

      await service.onListingRemovalResult(productId, String(listingId1), true);

      expect(listingService.deleteByProduct).toHaveBeenCalledWith(productId);
      expect(productModel.deleteOne).toHaveBeenCalledWith({ _id: productId });
      expect(events.emit).toHaveBeenCalledWith(
        'notification.requested',
        expect.objectContaining({ type: 'product.deleted' }),
      );
    });
  });

  describe('getDeletionStatus', () => {
    it('retorna null se o produto não existe (já concluído ou nunca pedido)', async () => {
      productModel.findById.mockReturnValue(mockExec(null));
      const result = await service.getDeletionStatus(productId);
      expect(result).toEqual({ deletionStatus: null });
    });

    it('retorna o status e motivo de falha quando presente', async () => {
      productModel.findById.mockReturnValue(
        mockExec({ deletionStatus: 'failed', deletionFailureReason: 'erro X' }),
      );
      const result = await service.getDeletionStatus(productId);
      expect(result).toEqual({ deletionStatus: 'failed', deletionFailureReason: 'erro X' });
    });
  });
});
