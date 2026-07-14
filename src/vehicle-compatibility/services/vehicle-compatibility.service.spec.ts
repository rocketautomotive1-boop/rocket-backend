import { VehicleCompatibilityService } from './vehicle-compatibility.service';

describe('VehicleCompatibilityService.atlasSearch year range fallback', () => {
  it('exige que o MESMO elemento do array years satisfaça from e to (evita casar 2000 com filtro 2004-2017)', async () => {
    const findChain: any = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const model: any = {
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('atlas unavailable')) }),
      find: jest.fn().mockReturnValue(findChain),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };
    const service = new VehicleCompatibilityService(model);

    await service.atlasSearch(
      { q: 'Palio 2004-2017' } as any,
      { freeText: 'Palio', yearRange: { from: 2004, to: 2017 } } as any,
    );

    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        years: { $elemMatch: { $gte: 2004, $lte: 2017 } },
      }),
    );
  });
});

describe('VehicleCompatibilityService.resolve', () => {
  let service: VehicleCompatibilityService;
  let atlasSearchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new VehicleCompatibilityService({} as any);
    atlasSearchSpy = jest.spyOn(service, 'atlasSearch').mockResolvedValue({ data: [], total: 0 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aplica o parser de busca livre (motor/combustível/faixa de ano) antes de chamar o Atlas Search', async () => {
    await service.resolve({ q: 'Fiat Toro 2.0 2016-2021 Diesel' } as any);

    expect(atlasSearchSpy).toHaveBeenCalledTimes(1);
    const [dtoArg, parsedArg] = atlasSearchSpy.mock.calls[0];
    expect(dtoArg).toMatchObject({ q: 'Fiat Toro 2.0 2016-2021 Diesel', active: true, limit: 20 });
    expect(parsedArg).toMatchObject({
      freeText: 'Fiat Toro',
      yearRange: { from: 2016, to: 2021 },
      fuelTags: ['diesel'],
      displacementCc: 2000,
    });
  });

  it('usa o limit informado no DTO em vez do default', async () => {
    await service.resolve({ q: 'gol', limit: 5 } as any);

    const [dtoArg] = atlasSearchSpy.mock.calls[0];
    expect(dtoArg.limit).toBe(5);
  });

  it('mapeia documentos retornados para o shape de candidato (vehicleId, make/model/version, year = maior de years[])', async () => {
    atlasSearchSpy.mockResolvedValue({
      data: [
        {
          _id: 'abc123',
          make: 'Fiat',
          model: 'Toro',
          version: 'Freedom',
          versionDisplay: 'Freedom 2.0',
          years: [2018, 2019, 2020],
          normalized: { engineTokens: ['2.0'], fuelTags: ['diesel'] },
        },
      ],
      total: 1,
    });

    const result = await service.resolve({ q: 'toro' } as any);

    expect(result.candidates).toEqual([
      {
        vehicleId: 'abc123',
        make: 'Fiat',
        model: 'Toro',
        version: 'Freedom',
        versionDisplay: 'Freedom 2.0',
        year: 2020,
        engineTokens: ['2.0'],
        fuelTags: ['diesel'],
      },
    ]);
  });

  it('candidato sem years retorna year undefined em vez de quebrar', async () => {
    atlasSearchSpy.mockResolvedValue({
      data: [{ _id: 'xyz', make: 'VW', model: 'Gol', version: '1.6', normalized: {} }],
      total: 1,
    });

    const result = await service.resolve({ q: 'gol' } as any);
    expect(result.candidates[0].year).toBeUndefined();
  });

  it('sem match retorna candidates vazio', async () => {
    const result = await service.resolve({ q: 'veiculo inexistente xyz123' } as any);
    expect(result.candidates).toEqual([]);
  });
});
