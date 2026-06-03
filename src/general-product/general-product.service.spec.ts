// backend/src/general-product/general-product.service.spec.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GeneralProductService } from './general-product.service';

describe('GeneralProductService', () => {
  const makeRepo = () => ({
    findByBarcode: jest.fn(),
    create: jest.fn(),
    updateByBarcode: jest.fn(),
  });

  it('rejects an invalid EAN-13 barcode before touching the repo', async () => {
    const repo = makeRepo();
    const service = new GeneralProductService(repo as any);

    await expect(
      service.register({ barcode: '1234567890000', name: 'X', tax: { ncm: '1' } } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a barcode that already exists', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue({ barcode: '7891000100103' });
    const service = new GeneralProductService(repo as any);

    await expect(
      service.register({ barcode: '7891000100103', name: 'X', tax: { ncm: '1' } } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates when barcode is valid and unused', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue(null);
    repo.create.mockResolvedValue({ barcode: '7891000100103', name: 'Nescau' });
    const service = new GeneralProductService(repo as any);

    const result = await service.register({ barcode: '7891000100103', name: 'Nescau', tax: { ncm: '18069000' } } as any);
    expect(result.name).toBe('Nescau');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('getCompletion returns all-false when product does not exist', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue(null);
    const service = new GeneralProductService(repo as any);

    const c = await service.getCompletion('7891000100103');
    expect(c).toEqual({ dados: false, imagens: false, precoEstoque: false, fiscal: false, readyToPublish: false });
  });

  it('getCompletion derives from the product fields', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue({ name: 'X', brand: { name: 'B' }, images: [{ url: 'u' }], price: '5', tax: { ncm: '1' } });
    const service = new GeneralProductService(repo as any);

    const c = await service.getCompletion('7891000100103');
    expect(c).toEqual({ dados: true, imagens: true, precoEstoque: true, fiscal: true, readyToPublish: true });
  });

  it('getCompletion rejects an invalid EAN-13', async () => {
    const repo = makeRepo();
    const service = new GeneralProductService(repo as any);
    await expect(service.getCompletion('123')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.findByBarcode).not.toHaveBeenCalled();
  });

  it('updateByBarcode validates the barcode then delegates to the repo', async () => {
    const repo = makeRepo();
    repo.updateByBarcode.mockResolvedValue({ barcode: '7891000100103', name: 'Nescau' });
    const service = new GeneralProductService(repo as any);

    const result = await service.updateByBarcode('7891000100103', { name: 'Nescau' });
    expect(result?.name).toBe('Nescau');
    expect(repo.updateByBarcode).toHaveBeenCalledWith('7891000100103', { name: 'Nescau' });
  });

  it('updateByBarcode rejects an invalid EAN-13 before touching the repo', async () => {
    const repo = makeRepo();
    const service = new GeneralProductService(repo as any);
    await expect(service.updateByBarcode('123', { name: 'X' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateByBarcode).not.toHaveBeenCalled();
  });
});
