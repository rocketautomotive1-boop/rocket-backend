import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { OrderRepository } from '../order.repository';
import { ProductService } from '../../product/product.service';
import { ProductRepository } from '../../product/product.repository';
import { PRODUCT_RESOLVER_PORT } from '../ports/product-resolver.port';
import { MARKETPLACE_ORDER_GATEWAY } from '../ports/marketplace-order.gateway';
import { STOCK_QUERY_PORT } from '../../stock/ports/stock-query.port';
import { STOCK_WRITE_PORT } from '../../stock/ports/stock-write.port';
import { ORDER_EVENTS } from '../events/order.events';

describe('OrderFulfillmentService.completePicking', () => {
  let service: OrderFulfillmentService;
  let orderRepository: { save: jest.Mock };
  let productService: { findOne: jest.Mock };
  let stockQuery: { referenceExists: jest.Mock; getProductStock: jest.Mock };
  let stockService: { move: jest.Mock };
  let eventEmitter: EventEmitter2;

  const PRODUCT_ID = '6955b688dfe7143a30376c01';

  const buildOrder = () => ({
    _id: 'order-1',
    externalId: 'MLB-1',
    marketplaceId: 'mp1',
    marketplaceTag: 'mercado_livre',
    accountId: 'acc1',
    status: 'processed',
    logisticsStatus: 'pending',
    history: [],
  });

  beforeEach(async () => {
    orderRepository = { save: jest.fn().mockResolvedValue(undefined) };
    productService = { findOne: jest.fn().mockResolvedValue({ _id: PRODUCT_ID, partNumber: 'PN-1' }) };
    stockQuery = {
      referenceExists: jest.fn().mockResolvedValue(false),
      getProductStock: jest.fn().mockResolvedValue({ onHand: 10 }),
    };
    stockService = { move: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderFulfillmentService,
        { provide: OrderRepository, useValue: orderRepository },
        { provide: ProductService, useValue: productService },
        { provide: ProductRepository, useValue: {} },
        { provide: PRODUCT_RESOLVER_PORT, useValue: {} },
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: {} },
        { provide: STOCK_QUERY_PORT, useValue: stockQuery },
        { provide: STOCK_WRITE_PORT, useValue: stockService },
        EventEmitter2,
      ],
    }).compile();

    service = moduleRef.get(OrderFulfillmentService);
    eventEmitter = moduleRef.get(EventEmitter2);
  });

  it('emite ORDER_EVENTS.READY_TO_SHIP após concluir o picking', async () => {
    const listener = jest.fn();
    eventEmitter.on(ORDER_EVENTS.READY_TO_SHIP, listener);

    const order = buildOrder();
    await service.completePicking(order as any, { [PRODUCT_ID]: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      orderId: 'order-1',
      externalId: 'MLB-1',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      stockUpdated: [PRODUCT_ID],
    });
  });

  it('não emite o evento quando o picking já foi processado (idempotência)', async () => {
    stockQuery.referenceExists.mockResolvedValue(true);
    const listener = jest.fn();
    eventEmitter.on(ORDER_EVENTS.READY_TO_SHIP, listener);

    const order = buildOrder();
    await service.completePicking(order as any, { [PRODUCT_ID]: 2 });

    expect(listener).not.toHaveBeenCalled();
    expect(stockService.move).not.toHaveBeenCalled();
  });
});
