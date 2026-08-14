import { ServiceUnavailableException } from '@nestjs/common';
import { AiImageService } from './ai-image.service';

function makeService(overrides: Partial<{
  product: any;
  generate: jest.Mock;
  uploadFile: jest.Mock;
  saveProcessedImage: jest.Mock;
}> = {}) {
  const product = overrides.product ?? {
    partNumber: 'BTC08206',
    barcode: '789',
    brand: { name: 'Cofap' },
    productTitles: [{ title: 'Amortecedor Cofap' }],
    attributes: [],
  };
  const productRepository = { findByIdLean: jest.fn().mockResolvedValue(product) } as any;
  const openAiImageClient = {
    generate: overrides.generate ?? jest.fn().mockResolvedValue([Buffer.from('img1'), Buffer.from('img2')]),
  } as any;
  const s3Service = {
    uploadFile: overrides.uploadFile ?? jest.fn().mockImplementation(async (_b: Buffer, key: string) => `https://cdn/${key}`),
  } as any;
  const processedImageService = {
    saveProcessedImage: overrides.saveProcessedImage ?? jest.fn().mockImplementation(async (i: any) => ({
      id: 'pi-' + i.key, url: i.url, key: i.key, batchCode: i.batchCode,
      batchNote: i.batchNote, productId: i.productId, mimeType: i.mimeType,
      source: i.source, createdAt: new Date().toISOString(),
    })),
  } as any;

  const service = new AiImageService(productRepository, openAiImageClient, s3Service, processedImageService);
  return { service, productRepository, openAiImageClient, s3Service, processedImageService };
}

describe('AiImageService.generate', () => {
  it('sobe cada imagem no S3 e registra no repositório com source ai', async () => {
    const { service, s3Service, processedImageService } = makeService();
    const result = await service.generate({ productId: 'p1', instruction: 'fundo branco', count: 2, size: '1024x1024' });

    expect(s3Service.uploadFile).toHaveBeenCalledTimes(2);
    expect(processedImageService.saveProcessedImage).toHaveBeenCalledTimes(2);
    expect(processedImageService.saveProcessedImage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ai', productId: 'p1' }),
    );
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('ai');
  });

  it('todas as imagens da requisição compartilham o mesmo batchCode', async () => {
    const { service, processedImageService } = makeService();
    await service.generate({ productId: 'p1', instruction: '', count: 2, size: '1024x1024' });
    const calls = processedImageService.saveProcessedImage.mock.calls.map((c: any[]) => c[0].batchCode);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]).toMatch(/^AI-/);
  });

  it('propaga erro de configuração quando o client falha por falta de chave', async () => {
    const generate = jest.fn().mockRejectedValue(new ServiceUnavailableException('sem chave'));
    const { service } = makeService({ generate });
    await expect(
      service.generate({ productId: 'p1', instruction: '', count: 1, size: '1024x1024' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
