// backend/src/general-product/general-product.repository.spec.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model } from 'mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { GeneralProductRepository } from './general-product.repository';

describe('GeneralProductRepository (unified ProductModel, domain:general)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<any>;
  let repo: GeneralProductRepository;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    model = connection.model(ProductModel.name, ProductSchema);
    repo = new GeneralProductRepository(model);
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  it('creates with domain:general and reads back (Decimal128 sanitized to string)', async () => {
    const created = await repo.create({
      barcode: '7891000100103',
      name: 'Nescau 400g',
      tax: { ncm: '18069000' } as any,
      price: '12.90' as any,
    });
    expect(created.barcode).toBe('7891000100103');
    expect((created as any).domain).toBe('general');

    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Nescau 400g');
    expect(typeof found?.price === 'string' || found?.price === undefined).toBe(true);
  });

  it('findByBarcode does NOT return an autopeças product with the same barcode', async () => {
    // an autopeças product (domain defaults to 'autopecas') sharing the barcode
    await model.create({ barcode: '7891000100103', name: 'Peça', partNumber: 'PN-1' });
    const found = await repo.findByBarcode('7891000100103');
    expect(found).toBeNull();
  });

  it('upsertDraftByBarcode creates a domain:general product when the barcode is new', async () => {
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['Nescau 400g'] });
    const found = await repo.findByBarcode('7891000100103');
    expect(found).not.toBeNull();
    expect(found?.draftData).toEqual({ titles: ['Nescau 400g'] });
    expect((found as any).domain).toBe('general');
  });

  it('upsertDraftByBarcode updates only draftData on an existing product', async () => {
    await repo.create({ barcode: '7891000100103', name: 'Nescau Existente', tax: { ncm: '18069000' } as any });
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['Sugestão IA'] });
    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Nescau Existente'); // user data preserved
    expect(found?.draftData).toEqual({ titles: ['Sugestão IA'] });
  });

  it('upsertDraftByBarcode is idempotent (two calls → one document)', async () => {
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['A'] });
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['A'] });
    const all = await (repo as any).model.find({ barcode: '7891000100103', domain: 'general' }).lean().exec();
    expect(all).toHaveLength(1);
  });

  it('updateByBarcode creates the product on first save (upsert) with only patch fields', async () => {
    const updated = await repo.updateByBarcode('7891000100103', { name: 'Nescau 400g', tax: { ncm: '18069000' } as any });
    expect(updated?.barcode).toBe('7891000100103');
    expect(updated?.name).toBe('Nescau 400g');
    expect((updated as any)?.tax?.ncm).toBe('18069000');
  });

  it('updateByBarcode patches only the given fields on an existing product', async () => {
    await repo.create({ barcode: '7891000100103', name: 'Antigo', tax: { ncm: '18069000' } as any });
    const updated = await repo.updateByBarcode('7891000100103', { name: 'Novo Nome' });
    expect(updated?.name).toBe('Novo Nome');
    expect((updated as any)?.tax?.ncm).toBe('18069000'); // untouched field preserved
  });

  it('updateByBarcode NEVER overwrites draftData and never changes domain', async () => {
    await repo.upsertDraftByBarcode('7891000100103', { titles: ['Sugestão IA'] });
    await repo.updateByBarcode('7891000100103', { name: 'Confirmado', draftData: { titles: ['HACK'] }, domain: 'autopecas' } as any);
    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Confirmado');
    expect(found?.draftData).toEqual({ titles: ['Sugestão IA'] }); // draft preserved
    expect((found as any).domain).toBe('general'); // domain guard
  });

  it('ensureByBarcode creates a domain:general shell (idempotent) and returns the id', async () => {
    const a = await repo.ensureByBarcode('7891000100103');
    expect(a.productId).toBeTruthy();
    const found = await repo.findByBarcode('7891000100103');
    expect((found as any).domain).toBe('general');
    expect((found as any).name).toBe('Item 7891000100103'); // placeholder

    // second call returns the same product (no duplicate)
    const b = await repo.ensureByBarcode('7891000100103');
    expect(b.productId).toBe(a.productId);
    const all = await (repo as any).model.find({ barcode: '7891000100103', domain: 'general' }).lean().exec();
    expect(all).toHaveLength(1);
  });

  it('ensureByBarcode does not overwrite an existing name', async () => {
    await repo.updateByBarcode('7891000100103', { name: 'Nescau Real' });
    await repo.ensureByBarcode('7891000100103');
    const found = await repo.findByBarcode('7891000100103');
    expect(found?.name).toBe('Nescau Real'); // $setOnInsert only
  });

  it('updateByBarcode stores money fields and sanitizes Decimal128 to string on read', async () => {
    await repo.updateByBarcode('7891000100103', { price: 12.9, costPrice: 8 } as any);
    const found = await repo.findByBarcode('7891000100103');
    expect(Number(found?.price)).toBeCloseTo(12.9, 2);
    expect(Number(found?.costPrice)).toBeCloseTo(8, 2);
  });
});
