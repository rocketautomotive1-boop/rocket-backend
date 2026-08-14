import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { UserGarageVehicleModel, UserGarageVehicleSchema } from '../schemas/user-garage-vehicle.schema';
import { GarageService } from './garage.service';

describe('GarageService', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<any>;
  let service: GarageService;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    model = connection.model(UserGarageVehicleModel.name, UserGarageVehicleSchema);
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  beforeEach(() => {
    service = new GarageService(model as any);
  });

  it('marca o primeiro veículo adicionado como ativo automaticamente', async () => {
    const created = await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    expect(created.active).toBe(true);
  });

  it('não marca o segundo veículo como ativo automaticamente', async () => {
    await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    const second = await service.add('user-1', { vehicleId: 'v2', label: 'Onix 1.0 2018' });
    expect(second.active).toBe(false);
  });

  it('add é idempotente por (userId, vehicleId) — não duplica', async () => {
    await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });

    const list = await service.list('user-1');
    expect(list).toHaveLength(1);
  });

  it('activate garante só 1 ativo por vez', async () => {
    const first = await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    const second = await service.add('user-1', { vehicleId: 'v2', label: 'Onix 1.0 2018' });

    await service.activate('user-1', String(second._id));

    const list = await service.list('user-1');
    const activeCount = list.filter((v: any) => v.active).length;
    expect(activeCount).toBe(1);
    expect(list.find((v: any) => String(v._id) === String(second._id))?.active).toBe(true);
    expect(list.find((v: any) => String(v._id) === String(first._id))?.active).toBe(false);
  });

  it('activate lança NotFoundException para veículo de outro usuário', async () => {
    const created = await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    await expect(service.activate('user-2', String(created._id))).rejects.toThrow(NotFoundException);
  });

  it('remove exclui o veículo do usuário', async () => {
    const created = await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    await service.remove('user-1', String(created._id));

    const list = await service.list('user-1');
    expect(list).toHaveLength(0);
  });

  it('remove lança NotFoundException para veículo de outro usuário', async () => {
    const created = await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    await expect(service.remove('user-2', String(created._id))).rejects.toThrow(NotFoundException);
  });

  it('list retorna só os veículos do usuário informado', async () => {
    await service.add('user-1', { vehicleId: 'v1', label: 'Gol 1.6 2015' });
    await service.add('user-2', { vehicleId: 'v2', label: 'Onix 1.0 2018' });

    const list = await service.list('user-1');
    expect(list).toHaveLength(1);
    expect(list[0].vehicleId).toBe('v1');
  });
});
