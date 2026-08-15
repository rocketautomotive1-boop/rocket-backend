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

  it('markUnitsAsDamaged: delega para o port com productId da rota e storeId do usuário autenticado', async () => {
    portMock.markUnitsAsDamaged.mockResolvedValue({ unitIds: ['DU1', 'DU2'] });

    const result = await controller.markUnitsAsDamaged('P1', reqWithStore, {
      sourceCondition: 'new',
      quantity: 2,
      targetCondition: 'damaged',
    } as any);

    expect(result).toEqual({ unitIds: ['DU1', 'DU2'] });
    expect(portMock.markUnitsAsDamaged).toHaveBeenCalledWith({
      productId: 'P1',
      storeId: 'S1',
      sourceCondition: 'new',
      quantity: 2,
      targetCondition: 'damaged',
      reason: undefined,
    });
  });

  it('markUnitsAsDamaged: rejeita quando o usuário não tem loja configurada', async () => {
    await expect(
      controller.markUnitsAsDamaged('P1', reqWithoutStore, {
        sourceCondition: 'new',
        quantity: 2,
        targetCondition: 'damaged',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(portMock.markUnitsAsDamaged).not.toHaveBeenCalled();
  });

  it('listDamagedUnits: delega para o port com productId, storeId do usuário e status opcional', async () => {
    portMock.listDamagedUnits.mockResolvedValue([]);

    await controller.listDamagedUnits('P1', reqWithStore, 'in_stock');

    expect(portMock.listDamagedUnits).toHaveBeenCalledWith('P1', 'S1', 'in_stock');
  });

  it('updateDamagedUnit: delega para o port com o storeId do usuário e o patch informado', async () => {
    portMock.updateDamagedUnit.mockResolvedValue({ id: 'DU1' });

    await controller.updateDamagedUnit('DU1', reqWithStore, { damageNotes: 'Risco' } as any);

    expect(portMock.updateDamagedUnit).toHaveBeenCalledWith('DU1', 'S1', { damageNotes: 'Risco' });
  });

  it('allocateDamagedUnit: delega para o port com storeId do usuário, warehouseId e position', async () => {
    portMock.allocateDamagedUnit.mockResolvedValue({ id: 'ALLOC1' });

    await controller.allocateDamagedUnit('DU1', reqWithStore, {
      warehouseId: 'WH1',
      position: 'Prateleira 3',
    } as any);

    expect(portMock.allocateDamagedUnit).toHaveBeenCalledWith('DU1', 'S1', 'WH1', 'Prateleira 3');
  });
});
