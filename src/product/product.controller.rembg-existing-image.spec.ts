import { BadRequestException, NotFoundException } from '@nestjs/common';

// uuid é ESM-only e quebra o parser do Jest — ProductController importa
// ProductDiscoveryService, que importa uuid, transitivamente. Mock antes do import
// real (mesmo padrão usado em outros specs deste módulo que tocam essa cadeia).
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { ProductController } from './product.controller';

/**
 * Botão "Remover fundo" no admin — envia uma imagem JÁ SALVA (existente no
 * produto, resolvida por slotId) para o rembg, sem passar por upload/multipart.
 * Espelha o fluxo síncrono de enqueue já usado em uploadImages, mas a origem do
 * binário é o S3 (download) em vez de um arquivo recém-enviado.
 */
describe('ProductController — POST :id/images/:slotId/rembg', () => {
  let controller: ProductController;
  let productService: {
    findOne: jest.Mock;
    markImageSlotProcessing: jest.Mock;
    markImageSlotFailed: jest.Mock;
  };
  let s3Service: { downloadFile: jest.Mock };
  let rembgEnqueueService: { enqueue: jest.Mock };

  const productId = 'p1';
  const slot = { slotId: 's1', key: 'products/p1/img.jpg', url: 'https://s3/img.jpg', mimeType: 'image/jpeg' };

  beforeEach(() => {
    productService = {
      findOne: jest.fn().mockResolvedValue({ id: productId, images: [slot] }),
      markImageSlotProcessing: jest.fn().mockResolvedValue(undefined),
      markImageSlotFailed: jest.fn().mockResolvedValue(undefined),
    };
    s3Service = { downloadFile: jest.fn().mockResolvedValue(Buffer.from('binary')) };
    rembgEnqueueService = { enqueue: jest.fn().mockResolvedValue({ jobId: 'job1', status: 'queued' }) };

    controller = Object.create(ProductController.prototype) as ProductController;
    (controller as any).productService = productService;
    (controller as any).s3Service = s3Service;
    (controller as any).rembgEnqueueService = rembgEnqueueService;
    (controller as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  });

  it('marca o slot como processing e enfileira o job rembg a partir do binário do S3', async () => {
    const result = await controller.rembgExistingImage(productId, 's1', {});

    expect(s3Service.downloadFile).toHaveBeenCalledWith('products/p1/img.jpg');
    expect(productService.markImageSlotProcessing).toHaveBeenCalledWith(productId, 's1');
    expect(rembgEnqueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        productId,
        slotId: 's1',
        fileBuffer: Buffer.from('binary'),
        mimeType: 'image/jpeg',
      }),
    );
    expect(result).toEqual({ jobId: 'job1', status: 'queued' });
  });

  it('rejeita com 404 quando o produto não existe', async () => {
    productService.findOne.mockResolvedValueOnce(null);

    await expect(controller.rembgExistingImage(productId, 's1', {})).rejects.toThrow(NotFoundException);
    expect(rembgEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('rejeita com 400 quando o slotId não existe no produto', async () => {
    await expect(controller.rembgExistingImage(productId, 'unknown', {})).rejects.toThrow(BadRequestException);
    expect(rembgEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('marca o slot como failed quando o enqueue falha, sem lançar (mesmo padrão de uploadImages)', async () => {
    rembgEnqueueService.enqueue.mockRejectedValueOnce(new Error('s3 down'));

    const result = await controller.rembgExistingImage(productId, 's1', {});

    expect(productService.markImageSlotFailed).toHaveBeenCalledWith(productId, 's1');
    expect(result).toEqual({ status: 'failed' });
  });
});
