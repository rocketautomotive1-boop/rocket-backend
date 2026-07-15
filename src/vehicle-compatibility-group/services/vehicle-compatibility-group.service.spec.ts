import { VehicleCompatibilityGroupService } from './vehicle-compatibility-group.service';
import { VehicleCompatibilityGroupNotFoundException } from '../../vehicle-shared/exceptions/vehicle.exceptions';

describe('VehicleCompatibilityGroupService', () => {
  let vehicleCompatibilityServiceMock: any;

  beforeEach(() => {
    vehicleCompatibilityServiceMock = {
      findManyByIds: jest.fn().mockResolvedValue([{ _id: 'v1', make: 'Fiat', model: 'Palio' }]),
    };
  });

  it('list() deriva vehicleCount a partir do tamanho de vehicleIds', async () => {
    const model: any = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { _id: 'g1', name: 'Palio 4p', vehicleIds: ['v1', 'v2', 'v3'], updatedAt: new Date('2026-01-01') },
        ]),
      }),
    };
    const service = new VehicleCompatibilityGroupService(model, vehicleCompatibilityServiceMock);

    const result = await service.list();

    expect(result).toEqual([
      { id: 'g1', name: 'Palio 4p', vehicleCount: 3, updatedAt: new Date('2026-01-01') },
    ]);
  });

  it('findByIdPopulated() resolve os veículos via VehicleCompatibilityService.findManyByIds', async () => {
    const model: any = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'g1', name: 'Palio 4p', vehicleIds: ['v1'] }),
      }),
    };
    const service = new VehicleCompatibilityGroupService(model, vehicleCompatibilityServiceMock);

    const result = await service.findByIdPopulated('g1');

    expect(vehicleCompatibilityServiceMock.findManyByIds).toHaveBeenCalledWith(['v1']);
    expect(result).toEqual({
      id: 'g1',
      name: 'Palio 4p',
      vehicles: [{ _id: 'v1', make: 'Fiat', model: 'Palio' }],
    });
  });

  it('findById() lança VehicleCompatibilityGroupNotFoundException quando não existe', async () => {
    const model: any = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };
    const service = new VehicleCompatibilityGroupService(model, vehicleCompatibilityServiceMock);

    await expect(service.findById('missing')).rejects.toThrow(VehicleCompatibilityGroupNotFoundException);
  });

  it('getVehicleIds() retorna só os ids, sem popular', async () => {
    const model: any = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'g1', name: 'Palio 4p', vehicleIds: ['v1', 'v2'] }),
      }),
    };
    const service = new VehicleCompatibilityGroupService(model, vehicleCompatibilityServiceMock);

    const result = await service.getVehicleIds('g1');

    expect(result).toEqual(['v1', 'v2']);
    expect(vehicleCompatibilityServiceMock.findManyByIds).not.toHaveBeenCalled();
  });

  it('delete() lança VehicleCompatibilityGroupNotFoundException quando nada foi deletado', async () => {
    const model: any = {
      deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }),
    };
    const service = new VehicleCompatibilityGroupService(model, vehicleCompatibilityServiceMock);

    await expect(service.delete('missing')).rejects.toThrow(VehicleCompatibilityGroupNotFoundException);
  });
});
