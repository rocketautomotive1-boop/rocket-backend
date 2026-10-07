import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { StoreListingModel, StoreListingSchema } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StoreListingStockLotModel, StoreListingStockLotSchema } from '../store-listing/schemas/store-listing-stock-lot.schema';

/**
 * Leituras SEM loja explícita (busca pública, bot, readiness sem usuário…) devem enxergar o produto
 * inteiro — a soma de TODAS as suas lojas — e não "a StoreListing mais antiga" (incidente 7086768:
 * 86 un. na loja nova, -48 na antiga; a leitura mostrava só a antiga). Mongo real, sem mocks de model.
 */
describe('StoreListingStockQueryService — leituras sem loja somam todas as lojas do produto', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: StoreListingStockQueryService;
  let storeListings: Model<any>;
  let balances: Model<any>;
  let movements: Model<any>;
  let lots: Model<any>;

  const product = new Types.ObjectId();
  const storeOld = new Types.ObjectId();
  const storeNew = new Types.ObjectId();
  let slOld: Types.ObjectId;
  let slNew: Types.ObjectId;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: StoreListingModel.name, schema: StoreListingSchema },
          { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
          { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
          { name: StoreListingStockLotModel.name, schema: StoreListingStockLotSchema },
        ]),
      ],
      providers: [StoreListingStockQueryService],
    }).compile();
    service = moduleRef.get(StoreListingStockQueryService);
    storeListings = moduleRef.get(getModelToken(StoreListingModel.name));
    balances = moduleRef.get(getModelToken(StoreListingStockBalanceModel.name));
    movements = moduleRef.get(getModelToken(StoreListingStockMovementModel.name));
    lots = moduleRef.get(getModelToken(StoreListingStockLotModel.name));
  });

  afterAll(async () => {
    await moduleRef.get<Connection>(getConnectionToken()).close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([storeListings, balances, movements, lots].map(m => m.deleteMany({})));
    // loja ANTIGA criada primeiro (a que a resolução "mais antiga" escolheria): -3 em estoque, custo 2
    const [a] = await storeListings.create([{ productId: product, storeId: storeOld }]);
    const [b] = await storeListings.create([{ productId: product, storeId: storeNew }]);
    slOld = a._id;
    slNew = b._id;
    const [lotOld] = await lots.create([{ storeListingId: slOld, condition: 'new', unitCost: '2' }]);
    const [lotNew] = await lots.create([{ storeListingId: slNew, condition: 'new', unitCost: '5' }]);
    // antiga: onHand 10 (custo 2); nova: onHand 20 (custo 5)
    await balances.create([
      { storeListingId: slOld, lotId: lotOld._id, boxId: null, condition: 'new', onHand: 10, reserved: 1 },
      { storeListingId: slNew, lotId: lotNew._id, boxId: null, condition: 'new', onHand: 20, reserved: 2 },
    ]);
    await movements.create([
      { storeListingId: slOld, lotId: lotOld._id, type: 'outbound', quantity: 1, date: new Date('2026-10-01T10:00:00Z'), condition: 'new' },
      { storeListingId: slNew, lotId: lotNew._id, type: 'inbound', quantity: 20, date: new Date('2026-10-03T10:00:00Z'), condition: 'damaged' },
      { storeListingId: slNew, lotId: lotNew._id, type: 'outbound', quantity: 2, date: new Date('2026-10-02T10:00:00Z'), condition: 'new' },
    ]);
  });

  it('getProductStock soma onHand/reserved de todas as lojas', async () => {
    expect(await service.getProductStock(String(product))).toEqual({
      productId: String(product), onHand: 30, reserved: 3, available: 27,
    });
  });

  it('getByCondition e getByLocation agregam todas as lojas', async () => {
    expect(await service.getByCondition(String(product))).toEqual([{ condition: 'new', onHand: 30, reserved: 3 }]);
    expect(await service.getByLocation(String(product))).toEqual([{ boxId: null, onHand: 30, reserved: 3 }]);
  });

  it('getProductCost é a média ponderada por quantidade entre os lotes de todas as lojas', async () => {
    // (10*2 + 20*5) / 30 = 4
    expect(await service.getProductCost(String(product))).toBeCloseTo(4, 5);
  });

  it('listMovements mescla as movimentações de todas as lojas (mais recente primeiro) e informa a loja de cada uma', async () => {
    const list: any[] = await service.listMovements(String(product), 50);
    expect(list.map(m => m.date.toISOString())).toEqual([
      '2026-10-03T10:00:00.000Z', '2026-10-02T10:00:00.000Z', '2026-10-01T10:00:00.000Z',
    ]);
    expect(list.map(m => m.storeId)).toEqual([String(storeNew), String(storeNew), String(storeOld)]);
  });

  it('listMovements respeita o limit sobre o conjunto mesclado', async () => {
    expect(await service.listMovements(String(product), 2)).toHaveLength(2);
  });

  it('getMovementStatistics soma contagem e quantidade por tipo em todas as lojas', async () => {
    expect(await service.getMovementStatistics(String(product))).toEqual({
      outbound: { count: 2, quantity: 3 },
      inbound: { count: 1, quantity: 20 },
    });
  });

  it('getListingSnapshot usa a movimentação mais recente entre todas as lojas', async () => {
    expect(await service.getListingSnapshot(String(product))).toEqual({ condition: 'damaged' });
  });

  it('getProductOnHandAcrossStores devolve o total do produto (usado por readiness sem usuário)', async () => {
    expect(await service.getProductOnHandAcrossStores(String(product))).toBe(30);
  });

  it('produto sem nenhuma StoreListing continua devolvendo zeros/vazio, sem lançar', async () => {
    const other = String(new Types.ObjectId());
    expect(await service.getProductStock(other)).toEqual({ productId: other, onHand: 0, reserved: 0, available: 0 });
    expect(await service.listMovements(other)).toEqual([]);
    expect(await service.getListingSnapshot(other)).toBeNull();
    expect(await service.getProductOnHandAcrossStores(other)).toBe(0);
  });

  it('as leituras COM loja explícita seguem isoladas (não herdam a outra loja)', async () => {
    expect((await service.getStoreStockSummary(String(product), String(storeOld))).onHand).toBe(10);
    expect((await service.getStoreStockSummary(String(product), String(storeNew))).onHand).toBe(20);
  });
});
