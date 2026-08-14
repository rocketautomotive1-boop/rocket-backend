import { VehicleCompatibilityService } from './vehicle-compatibility.service';

describe('VehicleCompatibilityService.atlasSearch precisão de múltiplos tokens', () => {
  it('exige cada token da query (ex.: "grand" E "vitara") via compound.must, não só um match solto em should', async () => {
    const aggregateExec = jest.fn().mockResolvedValue([{ data: [], meta: [] }]);
    const model: any = {
      aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
    };
    const service = new VehicleCompatibilityService(model, {} as any, {} as any);

    await service.atlasSearch(
      { q: 'Grand Vitara' } as any,
      { freeText: 'Grand Vitara' } as any,
    );

    const pipeline = model.aggregate.mock.calls[0][0];
    const compound = pipeline[0].$search.compound;

    expect(compound.must).toHaveLength(2);
    for (const clause of compound.must) {
      const paths = clause.compound.should.map((s: any) => s.text.path);
      expect(paths).toEqual(expect.arrayContaining(['makeKey', 'modelKey', 'versionKey', 'searchText']));
    }
    expect(compound.must[0].compound.should[0].text.query).toBe('Grand');
    expect(compound.must[1].compound.should[0].text.query).toBe('Vitara');

    // aliases/tags/fuzzy só entram como boost de ranking, nunca sozinhos garantem inclusão
    const shouldPaths = compound.should.map((s: any) => s.text.path);
    expect(shouldPaths).toEqual(['aliases', 'tags', 'searchText']);
  });
});

describe('VehicleCompatibilityService.atlasSearch engineDisplay filter', () => {
  it('filtra por engineDisplay exato (ex.: "2.5" não deve casar registro "2.4")', async () => {
    const aggregateExec = jest.fn().mockResolvedValue([{ data: [], meta: [] }]);
    const model: any = {
      aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
    };
    const service = new VehicleCompatibilityService(model, {} as any, {} as any);

    await service.atlasSearch(
      { q: 'L200 2.5' } as any,
      { freeText: 'L200', engineDisplay: '2.5' } as any,
    );

    const pipeline = model.aggregate.mock.calls[0][0];
    const filter = pipeline[0].$search.compound.filter;

    expect(filter).toContainEqual({ equals: { path: 'engineDisplay', value: '2.5' } });
  });
});

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
    const service = new VehicleCompatibilityService(model, {} as any, {} as any);

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
    service = new VehicleCompatibilityService({} as any, {} as any, {} as any);
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
      engineDisplay: '2.0',
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
          fuelTags: ['diesel'],
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
        fuelTags: ['diesel'],
      },
    ]);
  });

  it('candidato sem years retorna year undefined em vez de quebrar', async () => {
    atlasSearchSpy.mockResolvedValue({
      data: [{ _id: 'xyz', make: 'VW', model: 'Gol', version: '1.6' }],
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

describe('VehicleCompatibilityService.getUsage / deactivate', () => {
  const buildService = (count: number, rows: any[] = [], products: any[] = []) => {
    const model: any = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ matchedCount: 1 }) }),
    };
    const productCompatibilityModel: any = {
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(count) }),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(rows),
      }),
    };
    const productModel: any = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(products),
      }),
    };
    return { service: new VehicleCompatibilityService(model, productCompatibilityModel, productModel), model };
  };

  it('getUsage retorna count 0 e products vazio quando não há vínculo', async () => {
    const { service } = buildService(0);
    const result = await service.getUsage('vehicle-1');
    expect(result).toEqual({ count: 0, products: [] });
  });

  it('getUsage retorna count total e produtos vinculados (limitados)', async () => {
    const { service } = buildService(
      2,
      [{ product: 'p1' }, { product: 'p2' }],
      [{ _id: 'p1', name: 'Filtro de óleo' }, { _id: 'p2', name: 'Pastilha de freio' }],
    );
    const result = await service.getUsage('vehicle-1');
    expect(result).toEqual({
      count: 2,
      products: [
        { id: 'p1', name: 'Filtro de óleo' },
        { id: 'p2', name: 'Pastilha de freio' },
      ],
    });
  });

  it('deactivate prossegue com soft-delete quando não há vínculo', async () => {
    const { service, model } = buildService(0);
    await service.deactivate('vehicle-1');
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'vehicle-1' }, { $set: { active: false } });
  });

  it('deactivate lança VehicleCompatibilityInUseException quando há vínculo, sem tocar o veículo', async () => {
    const { service, model } = buildService(1, [{ product: 'p1' }], [{ _id: 'p1', name: 'Filtro de óleo' }]);
    await expect(service.deactivate('vehicle-1')).rejects.toMatchObject({
      response: { count: 1, products: [{ id: 'p1', name: 'Filtro de óleo' }] },
    });
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
