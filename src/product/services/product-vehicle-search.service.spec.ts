import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model, Types } from 'mongoose';
import { ProductModel, ProductSchema } from '../schemas/product.schema';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../schemas/product-compatibility.schema';
import { CategoryModel, CategorySchema } from '../schemas/category.schema';
import { ProductVehicleSearchService } from './product-vehicle-search.service';
import { SearchResultCacheService } from './search-result-cache.service';

describe('ProductVehicleSearchService — facets e filtros de busca por compatibilidade', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let productModel: Model<any>;
  let compatibilityModel: Model<any>;
  let categoryModel: Model<any>;
  let service: ProductVehicleSearchService;
  let pricing: { getBasePrices: jest.Mock };
  let stockQuery: { getAvailableBulk: jest.Mock };

  let catA: Types.ObjectId;
  let catB: Types.ObjectId;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    productModel = connection.model(ProductModel.name, ProductSchema);
    compatibilityModel = connection.model(ProductCompatibilityModel.name, ProductCompatibilitySchema);
    categoryModel = connection.model(CategoryModel.name, CategorySchema);
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await productModel.deleteMany({});
    await compatibilityModel.deleteMany({});
    await categoryModel.deleteMany({});
    jest.restoreAllMocks();
  });

  async function seed() {
    const categories = await categoryModel.create([
      { name: 'Palhetas', slug: 'palhetas' },
      { name: 'Filtros', slug: 'filtros' },
    ]);
    catA = categories[0]._id;
    catB = categories[1]._id;

    const products = await productModel.create([
      { name: 'Palheta Bosch 22"', partNumber: 'P1', active: true, brand: { name: 'Bosch' }, category: catA },
      { name: 'Palheta Bosch 18"', partNumber: 'P2', active: true, brand: { name: 'Bosch' }, category: catA },
      { name: 'Filtro Fram', partNumber: 'P3', active: true, brand: { name: 'Fram' }, category: catB },
      { name: 'Palheta inativa', partNumber: 'P4', active: false, brand: { name: 'Bosch' }, category: catA },
    ]);

    pricing = {
      getBasePrices: jest.fn().mockResolvedValue(
        new Map([
          [String(products[0]._id), 50],
          [String(products[1]._id), 30],
          [String(products[2]._id), 20],
          [String(products[3]._id), 999],
        ]),
      ),
    };

    stockQuery = { getAvailableBulk: jest.fn().mockResolvedValue(new Map()) };

    service = new ProductVehicleSearchService(
      productModel as any,
      compatibilityModel as any,
      categoryModel as any,
      {} as any,
      pricing as any,
      stockQuery as any,
      new SearchResultCacheService(),
    );

    // Score decrescente na ordem dos produtos — preserva a mesma ordem de relevância que os
    // testes existentes esperavam antes do canal de texto/ranking por score existir.
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue(
      products.map((p, i) => ({ id: String(p._id), score: products.length - i })),
    );
    jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
    jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([]);

    return products;
  }

  it('computa contagem de facets de marca/categoria/preço só sobre produtos ativos', async () => {
    await seed();
    const result = await service.searchByText('palheta');

    expect(result.data).toHaveLength(3); // exclui o inativo
    expect(result.facets.brands).toEqual(
      expect.arrayContaining([{ name: 'Bosch', count: 2 }, { name: 'Fram', count: 1 }]),
    );
    expect(result.facets.categories).toEqual(
      expect.arrayContaining([{ name: 'Palhetas', count: 2 }, { name: 'Filtros', count: 1 }]),
    );
    expect(result.facets.price).toEqual({ min: 20, max: 50, avg: (50 + 30 + 20) / 3 });
  });

  it('priceMin/priceMax estreita tanto os dados quanto os facets', async () => {
    await seed();
    const result = await service.searchByText('palheta', { priceMin: 25, priceMax: 60 });

    expect(result.data).toHaveLength(2); // só os dois Bosch (50 e 30), Fram (20) fica de fora
    expect(result.facets.brands).toEqual([{ name: 'Bosch', count: 2 }]);
    expect(result.facets.price).toEqual({ min: 30, max: 50, avg: 40 });
  });

  it('brandNames estreita os dados retornados mas facets refletem o conjunto elegível completo', async () => {
    await seed();
    const result = await service.searchByText('palheta', { brandNames: ['Bosch'] });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((p: any) => p.brand.name === 'Bosch')).toBe(true);
    // facets não se auto-excluem — ainda mostram Fram mesmo com Bosch selecionado
    expect(result.facets.brands).toEqual(
      expect.arrayContaining([{ name: 'Bosch', count: 2 }, { name: 'Fram', count: 1 }]),
    );
  });

  it('categoryNames filtra por categoria resolvida por nome', async () => {
    await seed();
    const result = await service.searchByText('palheta', { categoryNames: ['Filtros'] });

    expect(result.data).toHaveLength(1);
    expect(String(result.data[0].category)).toBe(String(catB));
  });

  it('anexa price (join do PricingModule) em cada produto retornado', async () => {
    const products = await seed();
    const result = await service.searchByText('palheta');

    const byId = new Map(result.data.map((p: any) => [String(p._id), p.price]));
    expect(byId.get(String(products[0]._id))).toBe(50);
    expect(byId.get(String(products[1]._id))).toBe(30);
  });

  it('nenhum id candidato não quebra, devolve resposta e facets vazios', async () => {
    productModel.create; // no-op, garante import usado
    service = new ProductVehicleSearchService(
      productModel as any,
      compatibilityModel as any,
      categoryModel as any,
      {} as any,
      { getBasePrices: jest.fn().mockResolvedValue(new Map()) } as any,
      { getAvailableBulk: jest.fn().mockResolvedValue(new Map()) } as any,
      new SearchResultCacheService(),
    );
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
    jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
    jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([]);

    const result = await service.searchByText('nada encontrado');
    expect(result.data).toEqual([]);
    expect(result.facets).toEqual({ brands: [], categories: [], price: { min: 0, max: 0, avg: 0 } });
  });

  it('preserva ordem de relevância do Atlas Search ao filtrar um subconjunto', async () => {
    const products = await seed();
    // ordem de relevância por score: P2 (30) primeiro, depois P1 (50), depois P3 (20)
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
      { id: String(products[1]._id), score: 3 },
      { id: String(products[0]._id), score: 2 },
      { id: String(products[2]._id), score: 1 },
    ]);

    const result = await service.searchByText('palheta', { brandNames: ['Bosch'] });
    expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[1]._id), String(products[0]._id)]);
  });

  it('vehicleId restringe o resultado de texto livre aos produtos vinculados a esse veículo (garagem ativa)', async () => {
    const products = await seed();
    const vehicleId = 'vehicle-toro-2020';

    // Só P1 (Palheta Bosch 22") tem vínculo com esse veículo
    await compatibilityModel.create({
      product: products[0]._id,
      productId: String(products[0]._id),
      vehicleId,
    });

    const result = await service.searchByText('palheta', { vehicleId });
    expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[0]._id)]);
  });

  it('vehicleId ainda inclui produtos isUniversalFit mesmo sem vínculo granular', async () => {
    const products = await seed();
    const vehicleId = 'vehicle-toro-2020';

    await productModel.updateOne({ _id: products[2]._id }, { $set: { isUniversalFit: true } });
    jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([String(products[2]._id)]);

    const result = await service.searchByText('palheta', { vehicleId });
    expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[2]._id)]);
  });

  describe('canal de texto direto do produto (name/displayName/partNumber)', () => {
    it('produto sem compatibilidade e não-universal aparece via match de texto quando não há veículo ativo', async () => {
      const products = await seed();
      // Nem compatibilidade (atlasSearchProductIds) nem universal — só o canal de texto acha.
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        { id: String(products[2]._id), score: 1 },
      ]);

      const result = await service.searchByText('filtro combustivel');
      expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[2]._id)]);
    });

    it('com vehicleId ativo, ignora matches vindos só do canal de texto (sem compatibilidade comprovada)', async () => {
      const products = await seed();
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        { id: String(products[2]._id), score: 1 },
      ]);

      const result = await service.searchByText('filtro combustivel', { vehicleId: 'vehicle-toro-2020' });
      expect(result.data).toEqual([]);
    });

    it('sem veículo ativo, ordena pelo score normalizado mesclado entre canais (compatibilidade não tem peso extra)', async () => {
      const products = await seed();
      // Canal de compatibilidade: P1 é só a metade do score máximo do canal (normaliza pra
      // 0.5). Canal de texto: P3 é o único resultado, normaliza pra 1 (score máximo do
      // próprio canal) — sem veículo ativo, o match de texto mais relevante (no seu canal)
      // vence mesmo sem "prioridade de compatibilidade".
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
        { id: String(products[1]._id), score: 10 },
        { id: String(products[0]._id), score: 5 },
      ]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        { id: String(products[2]._id), score: 3 },
      ]);

      const result = await service.searchByText('bosch fram');
      expect(result.data.map((p: any) => String(p._id))).toEqual([
        String(products[1]._id),
        String(products[2]._id),
        String(products[0]._id),
      ]);
    });

    it('sem veículo ativo, saldo>0 desempata produtos com o mesmo score normalizado', async () => {
      const products = await seed();
      // P1 e P3 empatam em score normalizado (cada um é o único no seu canal, normaliza pra 1);
      // P3 tem saldo disponível, P1 não — P3 deve vir primeiro.
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
        { id: String(products[0]._id), score: 5 },
      ]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        { id: String(products[2]._id), score: 5 },
      ]);
      stockQuery.getAvailableBulk.mockResolvedValue(new Map([[String(products[2]._id), 10]]));

      const result = await service.searchByText('bosch fram');
      expect(result.data.map((p: any) => String(p._id))).toEqual([
        String(products[2]._id),
        String(products[0]._id),
      ]);
    });
  });

  describe('isCompatible', () => {
    it('retorna true quando o produto é isUniversalFit, mesmo sem vínculo granular', async () => {
      const products = await seed();
      await productModel.updateOne({ _id: products[2]._id }, { $set: { isUniversalFit: true } });

      const compatible = await service.isCompatible(String(products[2]._id), 'vehicle-x');
      expect(compatible).toBe(true);
    });

    it('retorna true quando existe vínculo granular product_compatibilities', async () => {
      const products = await seed();
      const vehicleId = 'vehicle-toro-2020';
      await compatibilityModel.create({
        product: products[0]._id,
        productId: String(products[0]._id),
        vehicleId,
      });

      const compatible = await service.isCompatible(String(products[0]._id), vehicleId);
      expect(compatible).toBe(true);
    });

    it('retorna false quando não há vínculo nem isUniversalFit', async () => {
      const products = await seed();

      const compatible = await service.isCompatible(String(products[0]._id), 'vehicle-sem-vinculo');
      expect(compatible).toBe(false);
    });
  });
});
