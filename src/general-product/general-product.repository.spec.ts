// backend/src/general-product/general-product.repository.spec.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model } from 'mongoose';
import { GeneralProductModel, GeneralProductSchema } from './schemas/general-product.schema';
import { GeneralProductRepository } from './general-product.repository';

describe('GeneralProductRepository', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<any>;
  let repo: GeneralProductRepository;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    model = connection.model(GeneralProductModel.name, GeneralProductSchema);
    repo = new GeneralProductRepository(model);
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  it('creates and reads back a general product (Decimal128 sanitized to string)', async () => {
    const created = await repo.create({
      barcode: '7891000100103',
      name: 'Nescau 400g',
      ncm: '18069000',
      price: '12.90' as any,
    });
    expect(created.barcode).toBe('7891000100103');

    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Nescau 400g');
    expect(typeof found?.price === 'string' || found?.price === undefined).toBe(true);
  });

  it('enforces unique barcode (duplicate key 11000)', async () => {
    await repo.create({ barcode: '7891000100103', name: 'A', ncm: '18069000' });
    await expect(
      repo.create({ barcode: '7891000100103', name: 'B', ncm: '18069000' }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
