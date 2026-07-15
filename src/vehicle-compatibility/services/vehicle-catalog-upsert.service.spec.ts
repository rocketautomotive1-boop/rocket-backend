import { Test } from '@nestjs/testing';
import { VehicleCatalogUpsertService } from './vehicle-catalog-upsert.service';
import { VehicleCompatibilityService } from './vehicle-compatibility.service';
import { VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';

describe('VehicleCatalogUpsertService', () => {
  let service: VehicleCatalogUpsertService;
  let vehicleCompatibilityService: { upsertByCanonicalKey: jest.Mock };

  beforeEach(async () => {
    vehicleCompatibilityService = { upsertByCanonicalKey: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VehicleCatalogUpsertService,
        { provide: VehicleCompatibilityService, useValue: vehicleCompatibilityService },
      ],
    }).compile();

    service = moduleRef.get(VehicleCatalogUpsertService);
  });

  function catalogProduct(overrides: Partial<Record<string, string>> = {}, id = 'MLB1') {
    const defaults: Record<string, string> = {
      BRAND: 'Fiat',
      MODEL: 'Mobi',
      TRIM: '1.0 Like Flex 5p',
      VEHICLE_YEAR: '2023',
    };
    const attrs = { ...defaults, ...overrides };
    return {
      id,
      attributes: Object.entries(attrs).map(([attrId, value_name]) => ({ id: attrId, value_name })),
    };
  }

  it('upserta um veículo válido via upsertByCanonicalKey com origin ML_IMPORT', async () => {
    vehicleCompatibilityService.upsertByCanonicalKey.mockResolvedValue({ _id: 'v1' });

    const result = await service.upsertFromCatalogProducts([catalogProduct()]);

    expect(result.upserted).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(vehicleCompatibilityService.upsertByCanonicalKey).toHaveBeenCalledWith(
      expect.objectContaining({
        make: 'Fiat',
        model: 'Mobi',
        version: '1.0 Like Flex 5p',
        years: [2023],
        origin: VehicleOrigin.ML_IMPORT,
        mlVehicleId: 'MLB1',
      }),
    );
  });

  it('descarta produto sem BRAND/MODEL suficiente', async () => {
    const product = { id: 'MLB2', attributes: [{ id: 'MODEL', value_name: 'Mobi' }] };

    const result = await service.upsertFromCatalogProducts([product]);

    expect(result.upserted).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(vehicleCompatibilityService.upsertByCanonicalKey).not.toHaveBeenCalled();
  });

  it('descarta produto com displacement implausível (>6000cc)', async () => {
    const product = catalogProduct({ ENGINE_DISPLACEMENT: '6300 cc' }, 'MLB3');

    const result = await service.upsertFromCatalogProducts([product]);

    expect(result.upserted).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(vehicleCompatibilityService.upsertByCanonicalKey).not.toHaveBeenCalled();
  });

  it('aceita displacement plausível dentro do limiar', async () => {
    vehicleCompatibilityService.upsertByCanonicalKey.mockResolvedValue({ _id: 'v1' });
    const product = catalogProduct({ ENGINE_DISPLACEMENT: '1600 cc' }, 'MLB4');

    const result = await service.upsertFromCatalogProducts([product]);

    expect(result.upserted).toHaveLength(1);
    expect(vehicleCompatibilityService.upsertByCanonicalKey).toHaveBeenCalledWith(
      expect.objectContaining({ engine: expect.objectContaining({ displacement: '1600 cc' }) }),
    );
  });

  it('extrai features HAS_* com valor Sim', async () => {
    vehicleCompatibilityService.upsertByCanonicalKey.mockResolvedValue({ _id: 'v1' });
    const product = catalogProduct({ HAS_ABS_BRAKES: 'Sim', HAS_BLUETOOTH: 'Não' }, 'MLB5');

    await service.upsertFromCatalogProducts([product]);

    expect(vehicleCompatibilityService.upsertByCanonicalKey).toHaveBeenCalledWith(
      expect.objectContaining({ features: ['abs_brakes'] }),
    );
  });

  it('segue processando os demais quando um produto falha no upsert', async () => {
    vehicleCompatibilityService.upsertByCanonicalKey
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ _id: 'v2' });

    const result = await service.upsertFromCatalogProducts([
      catalogProduct({}, 'MLB6'),
      catalogProduct({}, 'MLB7'),
    ]);

    expect(result.upserted).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});
