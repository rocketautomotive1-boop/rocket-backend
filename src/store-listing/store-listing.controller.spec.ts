import { BadRequestException } from '@nestjs/common';
import { StoreListingController } from './store-listing.controller';
import { StoreListingPort } from './ports/store-listing.port';

describe('StoreListingController', () => {
  let controller: StoreListingController;
  let portMock: any;

  const reqWithStore = { user: { id: 'u1', storeId: 'S1' } };
  const reqWithoutStore = { user: { id: 'u1', storeId: null } };

  beforeEach(() => {
    portMock = {
      createWarehouse: jest.fn(),
      listWarehouses: jest.fn(),
      markUnitsAsDamaged: jest.fn(),
      listDamagedUnits: jest.fn(),
      updateDamagedUnit: jest.fn(),
      allocateDamagedUnit: jest.fn(),
    };

    controller = new StoreListingController(portMock as unknown as StoreListingPort);
  });

  it('createWarehouse: delega para o port com o storeId do usuário autenticado', async () => {
    portMock.createWarehouse.mockResolvedValue({ id: 'WH1', storeId: 'S1', name: 'Central' });

    const result = await controller.createWarehouse(reqWithStore, { name: 'Central' } as any);

    expect(result).toEqual({ id: 'WH1', storeId: 'S1', name: 'Central' });
    expect(portMock.createWarehouse).toHaveBeenCalledWith('S1', 'Central', undefined);
  });

  it('createWarehouse: rejeita quando o usuário não tem loja configurada', async () => {
    await expect(controller.createWarehouse(reqWithoutStore, { name: 'Central' } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(portMock.createWarehouse).not.toHaveBeenCalled();
  });

  it('listWarehouses: delega para o port com o storeId do usuário autenticado', async () => {
    portMock.listWarehouses.mockResolvedValue([{ id: 'WH1', storeId: 'S1', name: 'Central' }]);

    const result = await controller.listWarehouses(reqWithStore);

    expect(result).toEqual([{ id: 'WH1', storeId: 'S1', name: 'Central' }]);
    expect(portMock.listWarehouses).toHaveBeenCalledWith('S1');
  });

  it('markUnitsAsDamaged: delega para o port com storeListingId da rota', async () => {
    portMock.markUnitsAsDamaged.mockResolvedValue({ unitIds: ['DU1', 'DU2'] });

    const result = await controller.markUnitsAsDamaged('SL1', {
      sourceCondition: 'new',
      quantity: 2,
      targetCondition: 'damaged',
    } as any);

    expect(result).toEqual({ unitIds: ['DU1', 'DU2'] });
    expect(portMock.markUnitsAsDamaged).toHaveBeenCalledWith({
      storeListingId: 'SL1',
      sourceCondition: 'new',
      quantity: 2,
      targetCondition: 'damaged',
      reason: undefined,
    });
  });

  it('listDamagedUnits: delega para o port com storeListingId e status opcional', async () => {
    portMock.listDamagedUnits.mockResolvedValue([]);

    await controller.listDamagedUnits('SL1', 'in_stock');

    expect(portMock.listDamagedUnits).toHaveBeenCalledWith('SL1', 'in_stock');
  });

  it('updateDamagedUnit: delega para o port com o patch informado', async () => {
    portMock.updateDamagedUnit.mockResolvedValue({ id: 'DU1' });

    await controller.updateDamagedUnit('DU1', { damageNotes: 'Risco' } as any);

    expect(portMock.updateDamagedUnit).toHaveBeenCalledWith('DU1', { damageNotes: 'Risco' });
  });

  it('allocateDamagedUnit: delega para o port com warehouseId e position', async () => {
    portMock.allocateDamagedUnit.mockResolvedValue({ id: 'ALLOC1' });

    await controller.allocateDamagedUnit('DU1', { warehouseId: 'WH1', position: 'Prateleira 3' } as any);

    expect(portMock.allocateDamagedUnit).toHaveBeenCalledWith('DU1', 'WH1', 'Prateleira 3');
  });
});
