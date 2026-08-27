import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  ReconcileCheckpointModel,
  ReconcileCheckpointSchema,
} from './reconcile-checkpoint.schema';
import { OrderModel, OrderSchema } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { OrderReconciler } from './order-reconciler.service';
import { MARKETPLACE_ORDER_GATEWAY } from '../ports/marketplace-order.gateway';
import { OrderIngestService } from '../ingest/order-ingest.service';
import { OrderMetricsService } from '../observability/order-metrics.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';

describe('OrderReconciler (integration)', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let reconciler: OrderReconciler;
  let repo: OrderRepository;
  const ingest = { ingest: jest.fn() };
  const gateway = { fetchOrder: jest.fn(), listOrdersSince: jest.fn() };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: ReconcileCheckpointModel.name, schema: ReconcileCheckpointSchema },
          { name: OrderModel.name, schema: OrderSchema },
        ]),
      ],
      providers: [
        OrderReconciler,
        OrderRepository,
        OrderMetricsService,
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: gateway },
        { provide: OrderIngestService, useValue: ingest },
        { provide: MarketplaceRegistryService, useValue: { findAll: async () => [] } },
        { provide: MarketplaceTokenBrokerService, useValue: { listAccountsWithToken: async () => [] } },
      ],
    }).compile();

    reconciler = moduleRef.get(OrderReconciler);
    repo = moduleRef.get(OrderRepository);
    // prevent the reconciler from re-arming setTimeout during the test
    jest.spyOn(reconciler as any, 'scheduleNext').mockImplementation(() => {});
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(() => jest.clearAllMocks());

  it('ingests only missing/divergent orders and advances the cursor', async () => {
    gateway.listOrdersSince.mockResolvedValue([
      { id: 'KNOWN', status: 'paid', date_last_updated: '2026-06-05T00:00:00Z' },
      { id: 'MISSING', status: 'paid', date_last_updated: '2026-06-06T00:00:00Z' },
    ]);

    // seed KNOWN com status igual E shipping já num substatus TERMINAL (entregue) —
    // só assim não há gap nenhum a reconciliar (nem status, nem shipping).
    await repo.create({
      externalId: 'KNOWN',
      marketplaceId: '650000000000000000000001',
      status: 'paid',
      totalAmount: 1,
      items: [],
      shipping: { substatus: 'delivered' },
    });

    await reconciler.runFor('mkt1');

    expect(ingest.ingest).toHaveBeenCalledTimes(1);
    expect(ingest.ingest).toHaveBeenCalledWith('MISSING', 'mkt1', 'reconcile', undefined);
  });

  it('reingesta pedido com status comercial IGUAL mas shipping.substatus ainda não-terminal (rede de segurança p/ webhook de shipments perdido)', async () => {
    gateway.listOrdersSince.mockResolvedValue([
      { id: 'STALE_SHIPPING', status: 'paid', date_last_updated: '2026-06-07T00:00:00Z' },
    ]);

    // status comercial não divergiu (paid === paid), mas substatus travado em 'invoice_pending'
    // — exatamente o bug confirmado em produção (pedido preso ~24h enquanto o shipment real
    // avançou 7 estados). Precisa reingestar mesmo sem divergência de status comercial.
    await repo.create({
      externalId: 'STALE_SHIPPING',
      marketplaceId: '650000000000000000000001',
      status: 'paid',
      totalAmount: 1,
      items: [],
      shipping: { substatus: 'invoice_pending' },
    });

    await reconciler.runFor('mkt1');

    expect(ingest.ingest).toHaveBeenCalledTimes(1);
    expect(ingest.ingest).toHaveBeenCalledWith('STALE_SHIPPING', 'mkt1', 'reconcile', undefined);
  });
});
