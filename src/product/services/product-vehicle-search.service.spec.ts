import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model, Types } from 'mongoose';
import { ProductModel, ProductSchema } from '../schemas/product.schema';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../schemas/product-compatibility.schema';
import { CategoryModel, CategorySchema } from '../schemas/category.schema';
import { ProductVehicleSearchService } from './product-vehicle-search.service';
import { SearchResultCacheService } from './search-result-cache.service';
import { KnownBrandKeysCacheService } from './known-brand-keys-cache.service';
import { ProductSearchRankingService } from './product-search-ranking.service';

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
      { find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }) } as any,
      {} as any,
      pricing as any,
      stockQuery as any,
      new SearchResultCacheService(),
      { has: jest.fn().mockResolvedValue(false) } as any,
      new ProductSearchRankingService(),
    );

    // Nenhum canal encontra nada por padrão — cada teste que precisa de resultado
    // sobrescreve com jest.spyOn conforme o caso.
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
    jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
    jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([]);
    jest.spyOn(service as any, 'matchByBarcode').mockResolvedValue([]);

    return products;
  }

  // Os 3 produtos ativos entram todos via canal de texto direto (productTextSearchIds
  // devolve os 3 ids) — o ranking real decide a ordem depois, comparando texto contra
  // texto, mas os testes desta seção só verificam CONJUNTO (facets/filtros), não ordem.
  function mockAllActiveViaTextChannel(products: any[]) {
    jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue(
      products.filter((p: any) => p.active).map((p: any) => String(p._id)),
    );
  }

  it('computa contagem de facets de marca/categoria/preço só sobre produtos ativos', async () => {
    const products = await seed();
    mockAllActiveViaTextChannel(products);
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
    const products = await seed();
    mockAllActiveViaTextChannel(products);
    const result = await service.searchByText('palheta', { priceMin: 25, priceMax: 60 });

    expect(result.data).toHaveLength(2); // só os dois Bosch (50 e 30), Fram (20) fica de fora
    expect(result.facets.brands).toEqual([{ name: 'Bosch', count: 2 }]);
    expect(result.facets.price).toEqual({ min: 30, max: 50, avg: 40 });
  });

  it('brandNames estreita os dados retornados mas facets refletem o conjunto elegível completo', async () => {
    const products = await seed();
    mockAllActiveViaTextChannel(products);
    const result = await service.searchByText('palheta', { brandNames: ['Bosch'] });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((p: any) => p.brand.name === 'Bosch')).toBe(true);
    // facets não se auto-excluem — ainda mostram Fram mesmo com Bosch selecionado
    expect(result.facets.brands).toEqual(
      expect.arrayContaining([{ name: 'Bosch', count: 2 }, { name: 'Fram', count: 1 }]),
    );
  });

  it('categoryNames filtra por categoria resolvida por nome', async () => {
    const products = await seed();
    mockAllActiveViaTextChannel(products);
    const result = await service.searchByText('palheta', { categoryNames: ['Filtros'] });

    expect(result.data).toHaveLength(1);
    expect(String(result.data[0].category)).toBe(String(catB));
  });

  it('anexa price (join do PricingModule) em cada produto retornado', async () => {
    const products = await seed();
    mockAllActiveViaTextChannel(products);
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
      { find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }) } as any,
      {} as any,
      { getBasePrices: jest.fn().mockResolvedValue(new Map()) } as any,
      { getAvailableBulk: jest.fn().mockResolvedValue(new Map()) } as any,
      new SearchResultCacheService(),
      { has: jest.fn().mockResolvedValue(false) } as any,
      new ProductSearchRankingService(),
    );
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
    jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
    jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([]);
    jest.spyOn(service as any, 'matchByBarcode').mockResolvedValue([]);

    const result = await service.searchByText('nada encontrado');
    expect(result.data).toEqual([]);
    expect(result.facets).toEqual({ brands: [], categories: [], price: { min: 0, max: 0, avg: 0 } });
  });

  it('preserva ordem de relevância entre canais ao filtrar um subconjunto (compatibilidade com aplicação real bate mais forte)', async () => {
    const products = await seed();
    // P2 (Palheta Bosch 18") tem aplicação que bate "palheta" mais forte que P1 — ranking
    // real (ProductSearchRankingService) decide pela força do texto de aplicação, não por
    // um score arbitrário como antes.
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
      { id: String(products[1]._id), applicationTexts: ['Palheta Dianteira Toro'] },
      { id: String(products[0]._id), applicationTexts: ['Acessório'] },
    ]);

    const result = await service.searchByText('palheta', { brandNames: ['Bosch'] });
    expect(result.data.map((p: any) => String(p._id))).toEqual(
      expect.arrayContaining([String(products[1]._id), String(products[0]._id)]),
    );
    expect(result.data).toHaveLength(2);
  });

  it('vehicleId restringe o resultado de texto livre aos produtos vinculados a esse veículo (garagem ativa)', async () => {
    const products = await seed();
    const vehicleId = 'vehicle-toro-2020';

    // Só P1 (Palheta Bosch 22") tem vínculo com esse veículo — precisa aparecer tanto na
    // fonte de compatibilidade real (Mongo, consultada por resolveProductIdsForVehicles)
    // quanto no canal de retrieval (atlasSearchProductIds, mockado aqui).
    await compatibilityModel.create({
      product: products[0]._id,
      vehicleId,
    });
    jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
      { id: String(products[0]._id), applicationTexts: [] },
    ]);

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
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([String(products[2]._id)]);

      const result = await service.searchByText('filtro fram');
      expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[2]._id)]);
    });

    it('com vehicleId ativo, ignora matches vindos só do canal de texto (sem compatibilidade comprovada)', async () => {
      const products = await seed();
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([String(products[2]._id)]);

      const result = await service.searchByText('filtro fram', { vehicleId: 'vehicle-toro-2020' });
      expect(result.data).toEqual([]);
    });

    it('sem veículo ativo, produto com aplicação de compatibilidade que bate melhor a query vence texto genérico', async () => {
      const products = await seed();
      // P1 (Palheta Bosch 22") só tem match textual fraco ("bosch" isolado); P3 (Filtro Fram)
      // tem aplicação cadastrada batendo "filtro" E "fram" — ProductSearchRankingService
      // pontua mais alto quem bate mais palavras da query, não score arbitrário de canal.
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([
        { id: String(products[2]._id), applicationTexts: ['Filtro Fram 2020'] },
      ]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        String(products[0]._id),
        String(products[2]._id),
      ]);

      const result = await service.searchByText('filtro fram');
      expect(result.data[0]._id.toString()).toBe(String(products[2]._id));
    });

    it('sem veículo ativo, saldo>0 desempata produtos com score de ranking igual', async () => {
      const products = await seed();
      // P1 e P2 são ambos "Palheta Bosch" (mesma força de match textual pra "palheta bosch") —
      // empatam no ranking; P2 tem saldo disponível, P1 não — P2 deve vir primeiro.
      jest.spyOn(service as any, 'atlasSearchProductIds').mockResolvedValue([]);
      jest.spyOn(service as any, 'matchUniversalProductsByName').mockResolvedValue([]);
      jest.spyOn(service as any, 'productTextSearchIds').mockResolvedValue([
        String(products[0]._id),
        String(products[1]._id),
      ]);
      stockQuery.getAvailableBulk.mockResolvedValue(new Map([[String(products[1]._id), 10]]));

      const result = await service.searchByText('palheta bosch');
      expect(result.data.map((p: any) => String(p._id))).toEqual([
        String(products[1]._id),
        String(products[0]._id),
      ]);
    });
  });

  describe('canal de código de barras (matchByBarcode)', () => {
    it('acha produto por barcode exato mesmo sem match em nenhum outro canal', async () => {
      const products = await seed();
      await productModel.updateOne({ _id: products[2]._id }, { $set: { barcode: '7891234567890' } });
      jest.spyOn(service as any, 'matchByBarcode').mockRestore();

      const result = await service.searchByText('7891234567890');
      expect(result.data.map((p: any) => String(p._id))).toEqual([String(products[2]._id)]);
    });

    it('não faz match parcial — barcode diferente não retorna nada', async () => {
      const products = await seed();
      await productModel.updateOne({ _id: products[2]._id }, { $set: { barcode: '7891234567890' } });
      jest.spyOn(service as any, 'matchByBarcode').mockRestore();

      const result = await service.searchByText('789123456');
      expect(result.data).toEqual([]);
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
