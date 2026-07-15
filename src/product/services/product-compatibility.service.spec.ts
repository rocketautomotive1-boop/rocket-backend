import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ProductCompatibilityService } from './product-compatibility.service';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { ProductModel } from '../schemas/product.schema';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { ProductCompatibilityPositionService } from './product-compatibility-position.service';

describe('ProductCompatibilityService — disparo de resolução de posição', () => {
  let service: ProductCompatibilityService;
  let compatModel: { updateMany: jest.Mock };
  let positionService: { resolveForCompatibility: jest.Mock };

  beforeEach(async () => {
    compatModel = { updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    positionService = { resolveForCompatibility: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductCompatibilityService,
        { provide: getModelToken(ProductCompatibilityModel.name), useValue: compatModel },
        { provide: getModelToken(ProductModel.name), useValue: {} },
        { provide: VehicleCompatibilityService, useValue: {} },
        { provide: ProductCompatibilityPositionService, useValue: positionService },
      ],
    }).compile();

    service = moduleRef.get(ProductCompatibilityService);
  });

  const c1 = '507f1f77bcf86cd799439001';
  const c2 = '507f1f77bcf86cd799439002';

  it('dispara resolveForCompatibility em background para cada id marcado como sincronizado', async () => {
    await service.markAsSynced([c1, c2]);

    // fire-and-forget: dar um tick para a promise (não aguardada pelo método) rodar.
    await new Promise((resolve) => process.nextTick(resolve));

    expect(positionService.resolveForCompatibility).toHaveBeenCalledWith(c1);
    expect(positionService.resolveForCompatibility).toHaveBeenCalledWith(c2);
  });

  it('markAsSynced não lança mesmo se a resolução de posição falhar', async () => {
    positionService.resolveForCompatibility.mockRejectedValue(new Error('ML indisponível'));

    await expect(service.markAsSynced([c1])).resolves.not.toThrow();
  });

  it('não dispara resolução para ids numéricos (legado, sem _id válido de compat)', async () => {
    await service.markAsSynced([123]);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(positionService.resolveForCompatibility).not.toHaveBeenCalled();
  });
});
