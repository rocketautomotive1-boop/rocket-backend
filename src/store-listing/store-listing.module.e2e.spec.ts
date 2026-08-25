import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StoreListingModule } from './store-listing.module';
import { StoreListingModel } from './schemas/store-listing.schema';
import { MarketplaceListingModel } from './schemas/marketplace-listing.schema';
import { STORE_LISTING_PORT, StoreListingPort } from './ports/store-listing.port';
import { StockMovementType } from '../stock/domain/movement-type';
import { STOCK_QUERY_PORT } from '../stock/ports/stock-query.port';
import { PRICING_PORT } from '../pricing/ports/pricing.port';

/**
 * Substitui StockModule/PricingModule (@Global no AppModule real) neste teste isolado —
 * StoreListingModule injeta STOCK_QUERY_PORT/PRICING_PORT no construtor (getAllocationProducts),
 * mas nenhum teste aqui exercita allocations/boxes, então mocks vazios bastam. Precisa ser
 * @Global porque um módulo importado só enxerga providers do módulo-pai via export, não os
 * providers declarados direto em Test.createTestingModule({ providers: [...] }).
 */
@Global()
@Module({
  providers: [
    { provide: STOCK_QUERY_PORT, useValue: {} },
    { provide: PRICING_PORT, useValue: {} },
  ],
  exports: [STOCK_QUERY_PORT, PRICING_PORT],
})
class MockStockPricingModule {}

describe('StoreListingModule (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let storeListingModel: Model<any>;
  let marketplaceListingModel: Model<any>;
  let port: StoreListingPort;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), MockStockPricingModule, StoreListingModule],
    }).compile();

    storeListingModel = moduleRef.get(getModelToken(StoreListingModel.name));
    marketplaceListingModel = moduleRef.get(getModelToken(MarketplaceListingModel.name));
    port = moduleRef.get(STORE_LISTING_PORT);

    await storeListingModel.createCollection();
    await storeListingModel.init();
    await marketplaceListingModel.createCollection();
    await marketplaceListingModel.init();
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await storeListingModel.deleteMany({});
    await marketplaceListingModel.deleteMany({});
  });

  it('STORE_LISTING_PORT resolves to a working StoreListingService', async () => {
    expect(port).toBeDefined();
    const result = await port.findByProductAndStore('000000000000000000000001', '000000000000000000000002');
    expect(result).toBeNull();
  });

  it('enforces unique {productId, storeId} at the database level', async () => {
    await storeListingModel.create({ productId: '000000000000000000000001', storeId: '000000000000000000000002' });
    await expect(
      storeListingModel.create({ productId: '000000000000000000000001', storeId: '000000000000000000000002' }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('enforces unique {storeListingId, marketplaceTag, externalId} at the database level', async () => {
    const storeListingId = '000000000000000000000003';
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: 'MLB111',
      status: 'active',
    });
    await expect(
      marketplaceListingModel.create({
        storeListingId,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_B',
        externalId: 'MLB111',
        status: 'active',
      }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows two marketplace_listings for the same (storeListingId, marketplaceTag) when externalId differs', async () => {
    const storeListingId = '000000000000000000000005';
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: 'MLB111',
      status: 'active',
    });
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: 'MLB222',
      status: 'active',
    });

    const count = await marketplaceListingModel.countDocuments({ storeListingId, marketplaceTag: 'mercadolivre' });
    expect(count).toBe(2);
  });

  it('allows two marketplace_listings for the same storeListingId on DIFFERENT marketplaces', async () => {
    const storeListingId = '000000000000000000000004';
    // externalId distinto e presente (não null) em ambos: garante que o teste continua
    // discriminante sob o índice parcial novo (externalId:{$type:'string'}) — com null em
    // ambos, os dois documentos ficariam fora do índice e o teste passaria mesmo se
    // marketplaceTag deixasse de fazer parte da chave.
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: 'MLB_DIFFERENT_MARKETPLACE_1',
      status: 'active',
    });
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'shopee',
      accountId: 'ACC_C',
      externalId: 'SHOPEE_DIFFERENT_MARKETPLACE_1',
      status: 'active',
    });

    const count = await marketplaceListingModel.countDocuments({ storeListingId });
    expect(count).toBe(2);
  });

  describe('leitura store-aware (Fase 4, sub-projeto 3)', () => {
    const PRODUCT = '000000000000000000000010';
    const STORE_A = '000000000000000000000011';
    const STORE_B = '000000000000000000000012';

    it('getStockSummary retorna zero (sem lançar) quando a loja não tem StoreListing pro produto', async () => {
      const summary = await port.getStockSummary(PRODUCT, STORE_A);
      expect(summary).toEqual({ onHand: 0, reserved: 0, available: 0, avgCost: 0 });
    });

    it('getStockByCondition/getStockByLocation retornam lista vazia sem StoreListing', async () => {
      expect(await port.getStockByCondition(PRODUCT, STORE_A)).toEqual([]);
      expect(await port.getStockByLocation(PRODUCT, STORE_A)).toEqual([]);
    });

    it('duas lojas com estoque do mesmo produto têm saldos independentes — sem vazamento entre elas', async () => {
      const listingA = await port.createOrGetStoreListing(PRODUCT, STORE_A);
      const listingB = await port.createOrGetStoreListing(PRODUCT, STORE_B);

      await port.recordStockMovement({
        storeListingId: listingA.id,
        type: StockMovementType.INBOUND,
        quantity: 5,
        condition: 'new',
        unitCost: '2',
      });
      await port.recordStockMovement({
        storeListingId: listingB.id,
        type: StockMovementType.INBOUND,
        quantity: 9,
        condition: 'used',
        unitCost: '6',
      });

      const summaryA = await port.getStockSummary(PRODUCT, STORE_A);
      const summaryB = await port.getStockSummary(PRODUCT, STORE_B);
      expect(summaryA.onHand).toBe(5);
      expect(summaryB.onHand).toBe(9);
      expect(summaryA.avgCost).toBeCloseTo(2, 2);
      expect(summaryB.avgCost).toBeCloseTo(6, 2);

      const byConditionA = await port.getStockByCondition(PRODUCT, STORE_A);
      expect(byConditionA).toEqual([{ condition: 'new', onHand: 5, reserved: 0 }]);
    });

    it('getStockByLocation agrega por boxId, incluindo o "sem box" (null)', async () => {
      const listing = await port.createOrGetStoreListing(PRODUCT, STORE_A);
      const BOX = '000000000000000000000099';

      await port.recordStockMovement({
        storeListingId: listing.id,
        type: StockMovementType.INBOUND,
        quantity: 3,
        condition: 'new',
        toBoxId: BOX,
      });
      await port.recordStockMovement({
        storeListingId: listing.id,
        type: StockMovementType.INBOUND,
        quantity: 4,
        condition: 'new',
      });

      const byLocation = await port.getStockByLocation(PRODUCT, STORE_A);
      const boxed = byLocation.find((r) => String(r.boxId) === BOX);
      const unboxed = byLocation.find((r) => r.boxId == null);
      expect(boxed?.onHand).toBe(3);
      expect(unboxed?.onHand).toBe(4);
    });

    it('listStockMovements/getStockMovementStatistics retornam vazio sem StoreListing', async () => {
      expect(await port.listStockMovements(PRODUCT, STORE_A)).toEqual([]);
      expect(await port.getStockMovementStatistics(PRODUCT, STORE_A)).toEqual({});
    });

    it('listStockMovements/getStockMovementStatistics não vazam movimentos entre lojas', async () => {
      const listingA = await port.createOrGetStoreListing(PRODUCT, STORE_A);
      const listingB = await port.createOrGetStoreListing(PRODUCT, STORE_B);

      await port.recordStockMovement({
        storeListingId: listingA.id,
        type: StockMovementType.INBOUND,
        quantity: 5,
        condition: 'new',
        unitCost: '2',
      });
      await port.recordStockMovement({
        storeListingId: listingB.id,
        type: StockMovementType.OUTBOUND,
        quantity: 2,
        condition: 'new',
      });

      const movementsA = await port.listStockMovements(PRODUCT, STORE_A);
      const movementsB = await port.listStockMovements(PRODUCT, STORE_B);
      expect(movementsA).toHaveLength(1);
      expect(movementsA[0].type).toBe(StockMovementType.INBOUND);
      expect(movementsA[0].quantity).toBe(5);
      expect(movementsB).toHaveLength(1);
      expect(movementsB[0].type).toBe(StockMovementType.OUTBOUND);

      const statsA = await port.getStockMovementStatistics(PRODUCT, STORE_A);
      const statsB = await port.getStockMovementStatistics(PRODUCT, STORE_B);
      expect(statsA[StockMovementType.INBOUND]).toEqual({ count: 1, quantity: 5 });
      expect(statsA[StockMovementType.OUTBOUND]).toBeUndefined();
      expect(statsB[StockMovementType.OUTBOUND]).toEqual({ count: 1, quantity: 2 });
    });

    it('listStockMovements respeita o limit e ordena mais recente primeiro', async () => {
      const listing = await port.createOrGetStoreListing(PRODUCT, STORE_A);
      await port.recordStockMovement({ storeListingId: listing.id, type: StockMovementType.INBOUND, quantity: 1, condition: 'new' });
      await port.recordStockMovement({ storeListingId: listing.id, type: StockMovementType.INBOUND, quantity: 2, condition: 'new' });
      await port.recordStockMovement({ storeListingId: listing.id, type: StockMovementType.INBOUND, quantity: 3, condition: 'new' });

      const limited = await port.listStockMovements(PRODUCT, STORE_A, 2);
      expect(limited).toHaveLength(2);
      expect(limited[0].quantity).toBe(3);
      expect(limited[1].quantity).toBe(2);
    });
  });
});
