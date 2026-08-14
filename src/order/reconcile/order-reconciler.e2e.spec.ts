import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

import {
  ReconcileCheckpointModel,
  ReconcileCheckpointSchema,
  ReconcileCheckpointDocument,
} from './reconcile-checkpoint.schema';
import { OrderModel, OrderSchema, OrderDocument } from '../schemas/order.schema';
import { FiscalDocumentModel, FiscalDocumentSchema } from '../../fiscal/schemas/fiscal.schema';
import { OrderRepository } from '../order.repository';
import { OrderReconciler } from './order-reconciler.service';
import { OrderIngestService } from '../ingest/order-ingest.service';
import { OrderSyncPipeline } from '../ingest/order-sync.pipeline';
import { OrderMapperService } from '../ingest/order-mapper.service';
import { OrderMetricsService } from '../observability/order-metrics.service';
import { MARKETPLACE_ORDER_GATEWAY } from '../ports/marketplace-order.gateway';
import { STOCK_LEDGER_PORT } from '../ports/stock-ledger.port';
import { PRODUCT_RESOLVER_PORT } from '../ports/product-resolver.port';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { ORDER_EVENTS } from '../events/order.events';

/**
 * Ponta-a-ponta do OrderReconciler: reconciler REAL → OrderIngestService REAL →
 * OrderSyncPipeline REAL → OrderMapperService REAL → OrderRepository REAL, tudo contra
 * um mongodb-memory-server em REPLICA SET (transações). Os únicos mocks são as bordas
 * externas (a API do marketplace = gateway, o ledger de estoque, o publisher do
 * orchestrator e o RabbitMQ). Prova que um pedido que o webhook nunca entregou é, de
 * fato, conciliado e persistido — e que o cursor/metrics avançam.
 */
describe('OrderReconciler (end-to-end)', () => {
  const MKT = '650000000000000000000099';
  const PRODUCT_ID = '650000000000000000000001';

  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let reconciler: OrderReconciler;
  let repo: OrderRepository;
  let metrics: OrderMetricsService;
  let checkpoints: Model<ReconcileCheckpointDocument>;
  let orderModel: Model<OrderDocument>;

  // Borda externa: a "API do marketplace". listOrdersSince = delta poll, fetchOrder = detalhe.
  const gateway = { fetchOrder: jest.fn(), listOrdersSince: jest.fn(), getBillingInfo: jest.fn() };
  // Borda externa: ledger de estoque (transacional, recebe a session da TX).
  const stock = {
    deductAndLink: jest.fn().mockResolvedValue({
      movementIds: ['650000000000000000000abc'],
      items: [{ productId: '650000000000000000000001', quantity: 1 }],
    }),
    revert: jest.fn(),
    deductStandalone: jest.fn(),
    mirrorAfterCommit: jest.fn(),
  };
  // Borda externa: resolução de produto (1 item → 1 produto válido com custo 10).
  const resolver = {
    resolveProduct: jest.fn(),
    resolveProducts: jest.fn().mockResolvedValue(new Map([[0, PRODUCT_ID]])),
    getCostPrices: jest.fn().mockResolvedValue(new Map([[PRODUCT_ID, 10]])),
  };
  const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
  const orchestratorPublisher = { requestSync: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: ReconcileCheckpointModel.name, schema: ReconcileCheckpointSchema },
          { name: OrderModel.name, schema: OrderSchema },
          { name: FiscalDocumentModel.name, schema: FiscalDocumentSchema },
        ]),
      ],
      providers: [
        // cadeia REAL
        OrderReconciler,
        OrderIngestService,
        OrderSyncPipeline,
        OrderMapperService,
        OrderRepository,
        OrderMetricsService,
        // bordas externas (mocks legítimos)
        { provide: MARKETPLACE_ORDER_GATEWAY, useValue: gateway },
        { provide: STOCK_LEDGER_PORT, useValue: stock },
        { provide: PRODUCT_RESOLVER_PORT, useValue: resolver },
        { provide: AmqpConnection, useValue: amqp },
        { provide: OrchestratorPublisherService, useValue: orchestratorPublisher },
        // registry/broker só importam para o agendamento de boot — não usados em runFor()
        { provide: MarketplaceRegistryService, useValue: { findAll: async () => [] } },
        { provide: MarketplaceTokenBrokerService, useValue: { listAccountsWithToken: async () => [] } },
      ],
    }).compile();

    reconciler = moduleRef.get(OrderReconciler);
    repo = moduleRef.get(OrderRepository);
    metrics = moduleRef.get(OrderMetricsService);
    checkpoints = moduleRef.get(getModelToken(ReconcileCheckpointModel.name));
    orderModel = moduleRef.get(getModelToken(OrderModel.name));

    // Cria a collection + índices antes da 1ª escrita transacional (evita "catalog changes; retry")
    await orderModel.createCollection();
    await orderModel.init();

    // Impede o reconciler de re-armar setTimeout durante o teste
    jest.spyOn(reconciler as any, 'scheduleNext').mockImplementation(() => {});
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    stock.deductAndLink.mockResolvedValue({
      movementIds: ['650000000000000000000abc'],
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    });
    resolver.resolveProducts.mockResolvedValue(new Map([[0, PRODUCT_ID]]));
    resolver.getCostPrices.mockResolvedValue(new Map([[PRODUCT_ID, 10]]));
    await orderModel.deleteMany({});
    await checkpoints.deleteMany({});
  });

  it('concilia um pedido que o webhook nunca entregou (ponta-a-ponta)', async () => {
    // 1. O marketplace tem um pedido pago que NÃO existe localmente (gap de webhook).
    gateway.listOrdersSince.mockResolvedValue([
      { id: 'ORDER-LOST', status: 'paid', date_last_updated: '2026-06-19T10:00:00Z' },
    ]);
    gateway.fetchOrder.mockResolvedValue({
      id: 'ORDER-LOST',
      marketplaceId: MKT,
      marketplaceName: 'Mercado Livre',
      status: 'paid',
      date_created: '2026-06-19T09:55:00Z',
      total_amount: 250,
      items: [{ id: 'item-1', sku: 'SKU-1', title: 'Pastilha de Freio', quantity: 2, unit_price: 125 }],
    });

    const processed: any[] = [];
    moduleRef.get(EventEmitter2).on(ORDER_EVENTS.PROCESSED, (e) => processed.push(e));

    // 2. Dispara o reconciler manualmente.
    await reconciler.runFor(MKT);

    // 3. RESULTADO: o pedido foi de fato conciliado e persistido.
    const order = await repo.findByExternalId('ORDER-LOST');
    expect(order).not.toBeNull();
    expect(order!.status).toBe('paid');
    expect(order!.totalAmount).toBe(250);
    // Detectado pela conciliação (não webhook) — rastreabilidade.
    expect((order as any).reconcile?.detectedBy).toBe('reconcile');
    // Venda confirmada → estoque deduzido pela pipeline real.
    expect(order!.logisticsStatus).toBe('deducted');
    expect(stock.deductAndLink).toHaveBeenCalledTimes(1);
    // Evento de domínio emitido (downstream: precificação/notificação).
    expect(processed).toHaveLength(1);
    expect(processed[0].externalId).toBe('ORDER-LOST');

    // 4. Cursor avançou para o maior date_last_updated do delta.
    const cp = await checkpoints.findOne({ marketplaceId: MKT, accountId: null });
    expect(cp).not.toBeNull();
    expect(cp!.lastUpdatedCursor.toISOString()).toBe('2026-06-19T10:00:00.000Z');
    expect(cp!.consecutiveCleanRuns).toBe(0); // achou gap → não foi run limpo

    // 5. Metrics refletem a varredura + a ingestão por reconcile.
    const snap = metrics.snapshot();
    expect(snap.reconcileRuns).toBe(1);
    expect(snap.ingestBySource.reconcile).toBe(1);
  });

  it('não re-ingere pedido já presente com mesmo status (idempotente) e marca run limpo', async () => {
    // Pedido já existe localmente, em dia.
    await repo.create({
      externalId: 'ORDER-OK',
      marketplaceId: MKT,
      status: 'paid',
      totalAmount: 50,
      logisticsStatus: 'deducted',
      items: [],
    });
    gateway.listOrdersSince.mockResolvedValue([
      { id: 'ORDER-OK', status: 'paid', date_last_updated: '2026-06-19T11:00:00Z' },
    ]);

    // Métricas são in-memory e acumulam entre testes — comparamos o DELTA, não o absoluto.
    const before = metrics.snapshot().ingestBySource.reconcile ?? 0;

    await reconciler.runFor(MKT);

    // Não tocou na pipeline (sem fetchOrder, sem dedução).
    expect(gateway.fetchOrder).not.toHaveBeenCalled();
    expect(stock.deductAndLink).not.toHaveBeenCalled();

    const cp = await checkpoints.findOne({ marketplaceId: MKT, accountId: null });
    expect(cp!.consecutiveCleanRuns).toBe(1); // run limpo
    // run limpo → nenhuma ingestão nova por reconcile
    expect(metrics.snapshot().ingestBySource.reconcile ?? 0).toBe(before);
  });

  it('reconcilia divergência de status: local=paid, marketplace=cancelled → cancela + reverte estoque', async () => {
    // Pedido pago e deduzido localmente.
    await repo.create({
      externalId: 'ORDER-CANCEL',
      marketplaceId: MKT,
      status: 'paid',
      totalAmount: 80,
      logisticsStatus: 'deducted',
      items: [{ productId: PRODUCT_ID, sku: 'SKU-1', title: 'X', quantity: 1, unitPrice: 80 }],
    });
    // No marketplace virou cancelado.
    gateway.listOrdersSince.mockResolvedValue([
      { id: 'ORDER-CANCEL', status: 'cancelled', date_last_updated: '2026-06-19T12:00:00Z' },
    ]);
    gateway.fetchOrder.mockResolvedValue({
      id: 'ORDER-CANCEL',
      marketplaceId: MKT,
      marketplaceName: 'Mercado Livre',
      status: 'cancelled',
      date_created: '2026-06-19T09:00:00Z',
      total_amount: 80,
      items: [{ id: 'item-1', sku: 'SKU-1', title: 'X', quantity: 1, unit_price: 80 }],
    });

    await reconciler.runFor(MKT);

    const order = await repo.findByExternalId('ORDER-CANCEL');
    expect(order!.status).toBe('cancelled');
    expect(order!.logisticsStatus).toBe('cancelled');
    // Estoque revertido pela pipeline real (borda mockada recebeu a chamada).
    expect(stock.revert).toHaveBeenCalledTimes(1);
  });
});
