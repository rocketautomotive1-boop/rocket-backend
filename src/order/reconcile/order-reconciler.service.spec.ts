import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  ReconcileCheckpointModel,
  ReconcileCheckpointDocument,
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
  const registry = { findAll: jest.fn() };
  const broker = { listAccountsWithToken: jest.fn() };
  let checkpoints: Model<ReconcileCheckpointDocument>;

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
        { provide: MarketplaceRegistryService, useValue: registry },
        { provide: MarketplaceTokenBrokerService, useValue: broker },
      ],
    }).compile();

    reconciler = moduleRef.get(OrderReconciler);
    repo = moduleRef.get(OrderRepository);
    checkpoints = moduleRef.get(getModelToken(ReconcileCheckpointModel.name));
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    registry.findAll.mockResolvedValue([]);
    broker.listAccountsWithToken.mockResolvedValue([]);
    (reconciler as any).targets = [];
    (reconciler as any).targetsRefreshedAt = 0; // cada teste redescobre os alvos
  });

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

  describe('resiliência (incidente 18–20/set: 404 transitório matou o reconciler ML)', () => {
    const ref = (id: string, at = '2026-10-01T00:00:00Z') => ({ id, status: 'paid', date_last_updated: at });

    it('uma falha de ingest NÃO aborta o lote: os demais pedidos são ingeridos e o cursor avança', async () => {
      gateway.listOrdersSince.mockResolvedValue([ref('A', '2026-10-01T00:00:00Z'), ref('BOOM', '2026-10-02T00:00:00Z'), ref('C', '2026-10-03T00:00:00Z')]);
      ingest.ingest.mockImplementation(async (id: string) => {
        if (id === 'BOOM') throw new Error('Request failed with status code 404');
      });

      await expect(reconciler.runFor('mktR1')).resolves.toBeUndefined();

      expect(ingest.ingest.mock.calls.map(c => c[0])).toEqual(['A', 'BOOM', 'C']);
      const cp: any = await checkpoints.findOne({ marketplaceId: 'mktR1', accountId: null }).lean();
      expect(cp.lastUpdatedCursor.toISOString()).toBe('2026-10-03T00:00:00.000Z');
      expect(cp.failedRefs).toHaveLength(1);
      expect(cp.failedRefs[0]).toMatchObject({ externalId: 'BOOM', attempts: 1, dead: false });
      expect(cp.failedRefs[0].lastError).toContain('404');
    });

    it('pedido que falhou é retentado depois do backoff mesmo fora do delta, e sai da fila ao ter sucesso', async () => {
      await checkpoints.create({
        marketplaceId: 'mktR2', accountId: null, lastUpdatedCursor: new Date('2026-10-05T00:00:00Z'),
        failedRefs: [{ externalId: 'RETRY_ME', attempts: 2, nextRetryAt: new Date(Date.now() - 1000), lastError: 'x', dead: false }],
      });
      gateway.listOrdersSince.mockResolvedValue([]); // delta vazio: só a fila de falhas tem trabalho
      ingest.ingest.mockResolvedValue(undefined);

      await reconciler.runFor('mktR2');

      expect(ingest.ingest).toHaveBeenCalledWith('RETRY_ME', 'mktR2', 'reconcile', undefined);
      const cp: any = await checkpoints.findOne({ marketplaceId: 'mktR2', accountId: null }).lean();
      expect(cp.failedRefs).toHaveLength(0);
    });

    it('não retenta antes do nextRetryAt e marca como dead após o máximo de tentativas (sem sumir em silêncio)', async () => {
      await checkpoints.create({
        marketplaceId: 'mktR3', accountId: null, lastUpdatedCursor: new Date('2026-10-05T00:00:00Z'),
        failedRefs: [
          { externalId: 'NOT_YET', attempts: 1, nextRetryAt: new Date(Date.now() + 3600_000), lastError: 'x', dead: false },
          { externalId: 'LAST_STRAW', attempts: 7, nextRetryAt: new Date(Date.now() - 1000), lastError: 'x', dead: false },
        ],
      });
      gateway.listOrdersSince.mockResolvedValue([]);
      ingest.ingest.mockRejectedValue(new Error('still 404'));

      await reconciler.runFor('mktR3');

      expect(ingest.ingest).toHaveBeenCalledTimes(1);
      expect(ingest.ingest).toHaveBeenCalledWith('LAST_STRAW', 'mktR3', 'reconcile', undefined);
      const cp: any = await checkpoints.findOne({ marketplaceId: 'mktR3', accountId: null }).lean();
      const byId = Object.fromEntries(cp.failedRefs.map((f: any) => [f.externalId, f]));
      expect(byId.NOT_YET.attempts).toBe(1);
      expect(byId.LAST_STRAW).toMatchObject({ attempts: 8, dead: true });
    });

    it('falha ao listar o delta não propaga: registra o erro e agenda nova tentativa em breve (nextRunAt)', async () => {
      gateway.listOrdersSince.mockRejectedValue(new Error('Request failed with status code 404'));

      await expect(reconciler.runFor('mktR4')).resolves.toBeUndefined();

      const cp: any = await checkpoints.findOne({ marketplaceId: 'mktR4', accountId: null }).lean();
      expect(cp.lastError).toContain('404');
      expect(cp.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      expect(cp.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
      // cursor intacto: nada foi consumido
      expect(cp.lastUpdatedCursor.getTime()).toBeLessThan(Date.now());
    });

    it('tick(): roda checkpoints vencidos, ignora os ainda não vencidos, e nunca esquece um alvo que falhou antes', async () => {
      registry.findAll.mockResolvedValue([{ _id: 'mktT1', enabled: true }, { _id: 'mktT2', enabled: true }]);
      broker.listAccountsWithToken.mockResolvedValue([]);
      await checkpoints.create({ marketplaceId: 'mktT1', accountId: null, lastUpdatedCursor: new Date(0), nextRunAt: new Date(Date.now() - 1000) });
      await checkpoints.create({ marketplaceId: 'mktT2', accountId: null, lastUpdatedCursor: new Date(0), nextRunAt: new Date(Date.now() + 3600_000) });
      gateway.listOrdersSince.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);

      await reconciler.tick(); // mktT1 falha, mktT2 não vence
      expect(gateway.listOrdersSince).toHaveBeenCalledTimes(1);
      expect(gateway.listOrdersSince.mock.calls[0][0]).toBe('mktT1');

      // após a falha o alvo continua com nextRunAt persistido — força vencer e roda de novo
      await checkpoints.updateOne({ marketplaceId: 'mktT1', accountId: null }, { nextRunAt: new Date(Date.now() - 1) });
      await reconciler.tick();
      expect(gateway.listOrdersSince.mock.calls.filter(c => c[0] === 'mktT1')).toHaveLength(2);
    });

    it('tick(): descobre conta adicionada depois do boot (sem exigir restart) e cria o checkpoint', async () => {
      registry.findAll.mockResolvedValue([{ _id: 'mktT3', enabled: true }]);
      broker.listAccountsWithToken.mockResolvedValue([{ accountId: 'ACC_NEW' }]);
      gateway.listOrdersSince.mockResolvedValue([]);

      await reconciler.tick();

      expect(gateway.listOrdersSince).toHaveBeenCalledWith('mktT3', expect.any(Date), 'ACC_NEW');
      expect(await checkpoints.countDocuments({ marketplaceId: 'mktT3', accountId: 'ACC_NEW' })).toBe(1);
    });
  });
});
