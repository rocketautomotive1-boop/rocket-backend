// backend/src/general-product/general-product.service.spec.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GeneralProductService } from './general-product.service';

describe('GeneralProductService', () => {
  const makeRepo = () => ({
    findByBarcode: jest.fn(),
    create: jest.fn(),
  });

  it('rejects an invalid EAN-13 barcode before touching the repo', async () => {
    const repo = makeRepo();
    const service = new GeneralProductService(repo as any);

    await expect(
      service.register({ barcode: '1234567890000', name: 'X', ncm: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a barcode that already exists', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue({ barcode: '7891000100103' });
    const service = new GeneralProductService(repo as any);

    await expect(
      service.register({ barcode: '7891000100103', name: 'X', ncm: '1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates when barcode is valid and unused', async () => {
    const repo = makeRepo();
    repo.findByBarcode.mockResolvedValue(null);
    repo.create.mockResolvedValue({ barcode: '7891000100103', name: 'Nescau' });
    const service = new GeneralProductService(repo as any);

    const result = await service.register({ barcode: '7891000100103', name: 'Nescau', ncm: '18069000' });
    expect(result.name).toBe('Nescau');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});
