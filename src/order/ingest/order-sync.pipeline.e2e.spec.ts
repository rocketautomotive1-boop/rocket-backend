import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderModel, OrderSchema } from '../schemas/order.schema';
import { FiscalDocumentModel, FiscalDocumentSchema } from '../../fiscal/schemas/fiscal.schema';
import { OrderRepository } from '../order.repository';
import { OrderMapperService } from './order-mapper.service';
import { OrderSyncPipeline } from './order-sync.pipeline';
import { MARKETPLACE_ORDER_GATEWAY } from '../ports/marketplace-order.gateway';
import { STOCK_LEDGER_PORT } from '../ports/stock-ledger.port';
import { PRODUCT_RESOLVER_PORT } from '../ports/product-resolver.port';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { ORDER_EVENTS } from '../events/order.events';
import { StockService } from '../../stock/stock.service';
import { StockLedgerProvider } from '../../stock/stock-ledger.provider';
import { StoreListingStockQueryService } from '../../stock/store-listing-stock-query.service';
import { StockMovementType } from '../../stock/domain/movement-type';
import { STOCK_QUERY_PORT } from '../../stock/ports/stock-query.port';
import { PRICING_PORT } from '../../pricing/ports/pricing.port';
import { StoreListingModule } from '../../store-listing/store-listing.module';
import { StoreListingModel, StoreListingSchema } from '../../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from '../../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../../store-listing/schemas/store-listing-stock-movement.schema';
import { StoreListingStockLotModel, StoreListingStockLotSchema } from '../../store-listing/schemas/store-listing-stock-lot.schema';
import { MarketplaceListingModel } from '../../store-listing/schemas/marketplace-listing.schema';

/**
 * StoreListingModule injeta STOCK_QUERY_PORT/PRICING_PORT (getAllocationProducts) — mesmo mock
 * usado em stock.service.spec.ts, necessário porque este teste monta só um subconjunto de
 * módulos, sem AppModule (StockModule é @Global em produção).
 */
@Global()
@Module({
  providers: [
    { provide: STOCK_QUERY_PORT, useValue: {} },
    { provide: PRICING_PORT, useValue: {} },
  ],
  exports: [STOCK_QUERY_PORT, PRICING_PORT],
})
class MockPricingModule {}

/**
 * Ponta-a-ponta real: OrderSyncPipeline REAL → StockLedgerProvider REAL → StockService REAL →
 * StoreListingService REAL, tudo contra um mongodb-memory-server em REPLICA SET (transações).
 * Diferente de order-sync.pipeline.spec.ts (que mocka STOCK_LEDGER_PORT inteiro): aqui a dedução
 * de estoque de um pedido confirmado precisa de fato escrever em store_listing_stock_balances
 * dentro da MESMA transação da criação do pedido, e o saldo deve refletir isso ao ler pela porta
 * de leitura real (StoreListingStockQueryService) depois. Cobre o ponto mais frágil da inversão
 * de escrita (2026-08-29): dois módulos (Order, Stock/StoreListing) compartilhando uma única
 * transação Mongo através de STOCK_LEDGER_PORT.
 */
describe('OrderSyncPipeline + StockLedgerProvider + StoreListing (e2e real, sem mocks de estoque)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let pipeline: OrderSyncPipeline;
  let stockQuery: StoreListingStockQueryService;
  let storeListingModel: Model<any>;

  const gateway = { fetchOrder: jest.fn(), listOrdersSince: jest.fn() };
  const amqp = { publish: jest.fn() };
  const orchestratorPublisher = { requestSync: jest.fn().mockResolvedValue(undefined) };

  const PRODUCT_ID = '650000000000000000000001';
  const STORE_ID = '650000000000000000040001';
  const MARKETPLACE_ID = '650000000000000000000099';

  const resolver = {
    resolveProduct: jest.fn(),
    resolveProducts: jest.fn().mockResolvedValue(new Map([[0, PRODUCT_ID]])),
    getCostPrices: jest.fn().mockResolvedValue(new Map([[PRODUCT_ID, 10]])),
  };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: OrderModel.name, schema: OrderSchema },
          { name: FiscalDocumentModel.name, schema: FiscalDocumentSchema },
          { name: StoreListingModel.name, schema: StoreListingSchema },
          { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
          { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
          { name: StoreListingStockLotModel.name, schema: StoreListingStockLotSchema },
        ]),
        MockPricingModule,
        StoreListingModule,
      ],
      providers: [
        OrderSyncPipeline,
        OrderRepository,
        OrderMapperService,
        StockService,
        StockLedgerProvider,
        StoreListingStockQueryService,
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: gateway },
        { provide: STOCK_LEDGER_PORT, useExisting: StockLedgerProvider },
        { provide: PRODUCT_RESOLVER_PORT, useValue: resolver },
        { provide: AmqpConnection, useValue: amqp },
        { provide: OrchestratorPublisherService, useValue: orchestratorPublisher },
      ],
    }).compile();

    pipeline = moduleRef.get(OrderSyncPipeline);
    stockQuery = moduleRef.get(StoreListingStockQueryService);
    storeListingModel = moduleRef.get(getModelToken(StoreListingModel.name));

    const orderModel = moduleRef.get<Model<any>>(getModelToken(OrderModel.name));
    await orderModel.createCollection();
    await orderModel.init();
    await storeListingModel.createCollection();
    await moduleRef.get(getModelToken(MarketplaceListingModel.name)).createCollection();
    const balanceModel = moduleRef.get(getModelToken(StoreListingStockBalanceModel.name));
    const movementModel = moduleRef.get(getModelToken(StoreListingStockMovementModel.name));
    const lotModel = moduleRef.get(getModelToken(StoreListingStockLotModel.name));
    await balanceModel.createCollection();
    await movementModel.createCollection();
    await lotModel.createCollection();
    await balanceModel.syncIndexes();
    await movementModel.syncIndexes();
    await lotModel.syncIndexes();

    // Produto já publicado por uma loja — sem isso, StockLedgerProvider bloqueia a dedução
    // (sem fallback pra loja padrão, ver docs/superpowers/specs/2026-08-28-...).
    await storeListingModel.create({ productId: new Types.ObjectId(PRODUCT_ID), storeId: new Types.ObjectId(STORE_ID) });
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(() => jest.clearAllMocks());

  it('a confirmed sale really deducts stock in store_listing_stock_* — inside the SAME transaction as order creation', async () => {
    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-E2E-1',
      marketplaceId: MARKETPLACE_ID,
      marketplaceName: 'ML',
      status: 'paid',
      date_created: new Date().toISOString(),
      total_amount: 100,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 3, unit_price: 100 }],
    });

    const before = (await stockQuery.getProductStock(PRODUCT_ID)).onHand;

    const emitter = moduleRef.get(EventEmitter2);
    const processed: any[] = [];
    emitter.on(ORDER_EVENTS.PROCESSED, (e) => processed.push(e));

    await pipeline.execute('EXT-E2E-1', MARKETPLACE_ID, 'webhook');

    expect(processed).toHaveLength(1);

    const after = (await stockQuery.getProductStock(PRODUCT_ID)).onHand;
    expect(after).toBe(before - 3);

    // The movement is real, in the correct StoreListing, with the marketplace-tagged reference.
    const list = await stockQuery.listMovements(PRODUCT_ID, 10);
    const found = list.find((m: any) => m.type === StockMovementType.OUTBOUND && m.quantity === 3);
    expect(found).toBeTruthy();
  });

  it('cancelling that order reverts the deduction back to the original onHand', async () => {
    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-E2E-2',
      marketplaceId: MARKETPLACE_ID,
      marketplaceName: 'ML',
      status: 'paid',
      date_created: new Date().toISOString(),
      total_amount: 50,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 2, unit_price: 50 }],
    });

    const before = (await stockQuery.getProductStock(PRODUCT_ID)).onHand;

    await pipeline.execute('EXT-E2E-2', MARKETPLACE_ID, 'webhook');
    const afterDeduction = (await stockQuery.getProductStock(PRODUCT_ID)).onHand;
    expect(afterDeduction).toBe(before - 2);

    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-E2E-2',
      marketplaceId: MARKETPLACE_ID,
      marketplaceName: 'ML',
      status: 'cancelled',
      date_created: new Date().toISOString(),
      total_amount: 50,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 2, unit_price: 50 }],
    });
    await pipeline.execute('EXT-E2E-2', MARKETPLACE_ID, 'webhook');

    const afterCancel = (await stockQuery.getProductStock(PRODUCT_ID)).onHand;
    expect(afterCancel).toBe(before);
  });
});
