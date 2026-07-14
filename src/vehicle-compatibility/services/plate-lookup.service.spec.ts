import { PlateLookupService } from './plate-lookup.service';
import { InvalidPlateFormatException, PlateNotFoundException } from '../../vehicle-shared/exceptions/vehicle.exceptions';

describe('PlateLookupService.resolveByPlate', () => {
  let service: PlateLookupService;
  let cacheModel: any;
  let vehicleCompatibilityService: any;
  let providerClient: any;

  beforeEach(() => {
    cacheModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    vehicleCompatibilityService = {
      resolve: jest.fn().mockResolvedValue({ candidates: [] }),
    };
    providerClient = {
      fetch: jest.fn(),
    };

    service = new PlateLookupService(cacheModel, vehicleCompatibilityService, providerClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejeita placa mal formatada sem consultar cache ou provedor', async () => {
    await expect(service.resolveByPlate('123ABC')).rejects.toBeInstanceOf(InvalidPlateFormatException);
    expect(cacheModel.findOne).not.toHaveBeenCalled();
    expect(providerClient.fetch).not.toHaveBeenCalled();
  });

  it('cache hit: não chama o provedor externo e resolve a query com os dados cacheados', async () => {
    cacheModel.findOne.mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ make: 'Volkswagen', model: 'Gol', year: 2015, fuel: 'Flex' }),
      }),
    });

    await service.resolveByPlate('ABC1D23');

    expect(providerClient.fetch).not.toHaveBeenCalled();
    expect(vehicleCompatibilityService.resolve).toHaveBeenCalledWith({
      q: 'Volkswagen Gol 2015 Flex',
      limit: 20,
    });
  });

  it('cache miss: chama o provedor externo e grava no cache antes de resolver', async () => {
    cacheModel.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    cacheModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({}) });
    providerClient.fetch.mockResolvedValue({
      make: 'Fiat',
      model: 'Toro',
      year: 2019,
      fuel: 'Diesel',
      engine: '2.0',
      raw: { marca: 'Fiat' },
    });

    await service.resolveByPlate('ABC1D23');

    expect(providerClient.fetch).toHaveBeenCalledWith('ABC1D23');
    expect(cacheModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(vehicleCompatibilityService.resolve).toHaveBeenCalledWith({
      q: 'Fiat Toro 2019 Diesel',
      limit: 20,
    });
  });

  it('provedor externo sem resultado: lança PlateNotFoundException e não chama resolve()', async () => {
    cacheModel.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    providerClient.fetch.mockResolvedValue(null);

    await expect(service.resolveByPlate('ABC1D23')).rejects.toBeInstanceOf(PlateNotFoundException);
    expect(vehicleCompatibilityService.resolve).not.toHaveBeenCalled();
  });

  it('aceita placa no formato antigo (AAA0000) além do Mercosul', async () => {
    cacheModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ make: 'Ford', model: 'Ka' }) }),
    });

    await expect(service.resolveByPlate('abc-1234')).resolves.toBeDefined();
  });
});
