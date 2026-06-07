import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderModel, OrderSchema } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { OrderMapperService } from './order-mapper.service';
import { OrderSyncPipeline } from './order-sync.pipeline';
import { MARKETPLACE_ORDER_GATEWAY } from '../ports/marketplace-order.gateway';
import { STOCK_LEDGER_PORT } from '../ports/stock-ledger.port';
import { PRODUCT_RESOLVER_PORT } from '../ports/product-resolver.port';
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

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([{ name: OrderModel.name, schema: OrderSchema }]),
      ],
      providers: [
        OrderSyncPipeline,
        OrderRepository,
        OrderMapperService,
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: gateway },
        { provide: STOCK_LEDGER_PORT, useValue: stock },
        { provide: PRODUCT_RESOLVER_PORT, useValue: resolver },
        { provide: AmqpConnection, useValue: amqp },
      ],
    }).compile();

    pipeline = moduleRef.get(OrderSyncPipeline);
    emitter = moduleRef.get(EventEmitter2);
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
    stock.deductAndLink.mockResolvedValue({ movementIds: ['650000000000000000000abc'] });

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
});
