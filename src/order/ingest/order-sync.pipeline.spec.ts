import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
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

describe('OrderSyncPipeline (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let pipeline: OrderSyncPipeline;
  let emitter: EventEmitter2;

  const gateway = { fetchOrder: jest.fn(), listOrdersSince: jest.fn() };
  const stock = { deductAndLink: jest.fn(), revert: jest.fn(), deductStandalone: jest.fn() };
  const resolver = {
    resolveProduct: jest.fn(),
    resolveProducts: jest.fn().mockResolvedValue(new Map([[0, '650000000000000000000001']])),
    getCostPrices: jest.fn().mockResolvedValue(new Map([['650000000000000000000001', 10]])),
  };
  const amqp = { publish: jest.fn() };
  const orchestratorPublisher = { requestSync: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: OrderModel.name, schema: OrderSchema },
          { name: FiscalDocumentModel.name, schema: FiscalDocumentSchema },
        ]),
      ],
      providers: [
        OrderSyncPipeline,
        OrderRepository,
        OrderMapperService,
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: gateway },
        { provide: STOCK_LEDGER_PORT, useValue: stock },
        { provide: PRODUCT_RESOLVER_PORT, useValue: resolver },
        { provide: AmqpConnection, useValue: amqp },
        { provide: OrchestratorPublisherService, useValue: orchestratorPublisher },
      ],
    }).compile();

    pipeline = moduleRef.get(OrderSyncPipeline);
    emitter = moduleRef.get(EventEmitter2);

    // Build the Order collection + indexes up front so the first transactional write
    // doesn't lazily mutate the catalog while a multi-document transaction is open
    // (MongoServerError "catalog changes; please retry"). Deterministic across co-runs.
    const orderModel = moduleRef.get<Model<any>>(getModelToken(OrderModel.name));
    await orderModel.createCollection();
    await orderModel.init();
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates order, deducts stock, emits PROCESSED for a confirmed sale', async () => {
    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-1',
      marketplaceId: '650000000000000000000099',
      marketplaceName: 'ML',
      status: 'paid',
      date_created: new Date().toISOString(),
      total_amount: 100,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 1, unit_price: 100 }],
    });
    stock.deductAndLink.mockResolvedValue({
      movementIds: ['650000000000000000000abc'],
      items: [{ productId: '650000000000000000000001', quantity: 1 }],
    });

    const seen: any[] = [];
    emitter.on(ORDER_EVENTS.PROCESSED, (e) => seen.push(e));

    await pipeline.execute('EXT-1', '650000000000000000000099', 'webhook');

    expect(stock.deductAndLink).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].externalId).toBe('EXT-1');
  });

  it('aborts silently when the marketplace returns no order', async () => {
    gateway.fetchOrder.mockResolvedValue(null);
    await pipeline.execute('MISSING', '650000000000000000000099', 'reconcile');
    expect(stock.deductAndLink).not.toHaveBeenCalled();
  });

  it('enfileira outbox sync para cada produto deduzido (mesma sessão da TX)', async () => {
    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-TX',
      marketplaceId: '650000000000000000000099',
      marketplaceName: 'ML',
      status: 'paid',
      date_created: new Date().toISOString(),
      total_amount: 100,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 1, unit_price: 100 }],
    });
    stock.deductAndLink.mockResolvedValue({
      movementIds: ['650000000000000000000abc'],
      items: [{ productId: '650000000000000000000001', quantity: 1 }],
    });

    await pipeline.execute('EXT-TX', '650000000000000000000099', 'webhook');

    expect(orchestratorPublisher.requestSync).toHaveBeenCalledWith(
      { productId: expect.any(String), reason: 'stock_deduction' },
      expect.anything(), // the ClientSession
    );
  });

  it('cancelamento limpa shipping.status/substatus (bug confirmado em produção: pedido cancelado mostrava status de envio antigo)', async () => {
    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-CANCEL',
      marketplaceId: '650000000000000000000099',
      marketplaceName: 'ML',
      status: 'paid',
      date_created: new Date().toISOString(),
      total_amount: 100,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 1, unit_price: 100 }],
      shipping: { status: 'pending', substatus: 'buffered' },
    });
    stock.deductAndLink.mockResolvedValue({
      movementIds: ['650000000000000000000abd'],
      items: [{ productId: '650000000000000000000001', quantity: 1 }],
    });

    await pipeline.execute('EXT-CANCEL', '650000000000000000000099', 'webhook');

    const orderModel = moduleRef.get<Model<any>>(getModelToken(OrderModel.name));
    const created = await orderModel.findOne({ externalId: 'EXT-CANCEL' }).lean();
    expect(created!.shipping.substatus).toBe('buffered');

    gateway.fetchOrder.mockResolvedValue({
      id: 'EXT-CANCEL',
      marketplaceId: '650000000000000000000099',
      marketplaceName: 'ML',
      status: 'cancelled',
      date_created: new Date().toISOString(),
      total_amount: 100,
      items: [{ id: 'i1', sku: 'S1', title: 'X', quantity: 1, unit_price: 100 }],
      shipping: { status: 'pending', substatus: 'buffered' },
    });

    await pipeline.execute('EXT-CANCEL', '650000000000000000000099', 'webhook');

    const cancelled = await orderModel.findOne({ externalId: 'EXT-CANCEL' }).lean();
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.shipping.status).toBe('cancelled');
    expect(cancelled!.shipping.substatus).toBe('cancelled');
  });
});
