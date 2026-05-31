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

  it('upsertDraftByBarcode creates a product when the barcode is new', async () => {
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['Nescau 400g'] });
    const found = await repo.findByBarcode('7891000100103');
    expect(found).not.toBeNull();
    expect(found?.draftData).toEqual({ titles: ['Nescau 400g'] });
  });

  it('upsertDraftByBarcode updates only draftData on an existing product', async () => {
    await repo.create({ barcode: '7891000100103', name: 'Nescau Existente', ncm: '18069000' });
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['Sugestão IA'] });
    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Nescau Existente'); // user data preserved
    expect(found?.draftData).toEqual({ titles: ['Sugestão IA'] });
  });

  it('upsertDraftByBarcode is idempotent (two calls → one document)', async () => {
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['A'] });
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['A'] });
    const all = await (repo as any).model.find({ barcode: '7891000100103' }).lean().exec();
    expect(all).toHaveLength(1);
  });
});
