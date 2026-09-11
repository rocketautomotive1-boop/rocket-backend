import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProductCompatibilityService } from './product-compatibility.service';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { ProductModel } from '../schemas/product.schema';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { ProductCompatibilityPositionService } from './product-compatibility-position.service';
import { CompatibilityGroupPropagationService } from './compatibility-group-propagation.service';

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
        { provide: CompatibilityGroupPropagationService, useValue: {} },
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

describe('ProductCompatibilityService — deleteAllForProduct (isUniversalFit)', () => {
  let service: ProductCompatibilityService;
  let compatModel: { deleteMany: jest.Mock; find: jest.Mock };
  let productModel: { updateOne: jest.Mock };

  beforeEach(async () => {
    compatModel = {
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 3 }) }),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };
    productModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductCompatibilityService,
        { provide: getModelToken(ProductCompatibilityModel.name), useValue: compatModel },
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: VehicleCompatibilityService, useValue: { findManyByIds: jest.fn().mockResolvedValue([]) } },
        { provide: ProductCompatibilityPositionService, useValue: {} },
        { provide: CompatibilityGroupPropagationService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ProductCompatibilityService);
  });

  const productId = new Types.ObjectId().toString();

  it('remove todas as compatibilidades do produto e recomputa o summary', async () => {
    const count = await service.deleteAllForProduct(productId);

    expect(compatModel.deleteMany).toHaveBeenCalledWith({ product: new Types.ObjectId(productId) });
    expect(count).toBe(3);
    expect(productModel.updateOne).toHaveBeenCalled(); // recomputeCompatibilitySummary disparado
  });

  it('não recomputa summary quando nada foi removido', async () => {
    compatModel.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) });

    const count = await service.deleteAllForProduct(productId);

    expect(count).toBe(0);
    expect(productModel.updateOne).not.toHaveBeenCalled();
  });

  it('retorna 0 sem tocar no banco quando productId é inválido', async () => {
    const count = await service.deleteAllForProduct('not-an-object-id');

    expect(count).toBe(0);
    expect(compatModel.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * markSyncedForExternalIds substitui markAsSynced como o caminho usado por qualquer sync
 * real com o ML — a diferença é a granularidade: marca syncedExternalIds (array, por
 * listing), nunca um bool único por-produto (ver comentário no schema e em
 * ProductService.pushCompatibilitiesToMercadoLivre sobre o bug corrigido 2026-09-11).
 */
describe('ProductCompatibilityService — markSyncedForExternalIds / getUnsyncedByProduct (granularidade por listing)', () => {
  let service: ProductCompatibilityService;
  let compatModel: { updateMany: jest.Mock; find: jest.Mock };
  let positionService: { resolveForCompatibility: jest.Mock };

  beforeEach(async () => {
    compatModel = {
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
    };
    positionService = { resolveForCompatibility: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductCompatibilityService,
        { provide: getModelToken(ProductCompatibilityModel.name), useValue: compatModel },
        { provide: getModelToken(ProductModel.name), useValue: {} },
        { provide: VehicleCompatibilityService, useValue: {} },
        { provide: ProductCompatibilityPositionService, useValue: positionService },
        { provide: CompatibilityGroupPropagationService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ProductCompatibilityService);
  });

  const c1 = '507f1f77bcf86cd799439001';
  const c2 = '507f1f77bcf86cd799439002';

  it('acrescenta ($addToSet) os externalIds bem-sucedidos, nunca substitui o array', async () => {
    await service.markSyncedForExternalIds([c1, c2], ['MLB_OK']);

    expect(compatModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [c1, c2] } },
      { $addToSet: { syncedExternalIds: { $each: ['MLB_OK'] } } },
    );
  });

  it('não toca no banco quando não há ids ou não há externalIds de sucesso', async () => {
    await service.markSyncedForExternalIds([], ['MLB_OK']);
    await service.markSyncedForExternalIds([c1], []);

    expect(compatModel.updateMany).not.toHaveBeenCalled();
  });

  it('dispara resolveForCompatibility em background (mesmo comportamento do markAsSynced antigo)', async () => {
    await service.markSyncedForExternalIds([c1], ['MLB_OK']);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(positionService.resolveForCompatibility).toHaveBeenCalledWith(c1);
  });

  it('getUnsyncedByProduct devolve [] sem consultar o banco quando não há listing vivo', async () => {
    const result = await service.getUnsyncedByProduct(c1, []);

    expect(result).toEqual([]);
    expect(compatModel.find).not.toHaveBeenCalled();
  });

  it('getUnsyncedByProduct consulta por $expr comparando syncedExternalIds contra os listings vivos', async () => {
    await service.getUnsyncedByProduct(c1, ['MLB_OK', 'MLB_FAIL']);

    const query = compatModel.find.mock.calls[0][0];
    expect(query.product).toEqual(new Types.ObjectId(c1));
    expect(query.$expr).toBeDefined();
  });
});
