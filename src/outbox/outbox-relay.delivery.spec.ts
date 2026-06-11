/**
 * Delivery-guarantee integration test for the outbox → RabbitMQ hop.
 *
 * This is the gate for requirement #1 (no silent loss on the backend→orchestrator hop).
 * It exercises the REAL OutboxRepository + OutboxRelayService + a REAL RabbitMQ broker:
 * a message enqueued into the outbox must end up published on the broker, and the doc
 * must flip to `published` ONLY after the broker confirms.
 *
 * Requires a reachable RabbitMQ (RABBITMQ_URL, default amqp://localhost:5672) and a Mongo
 * replica set (for the repository; provided in-process via MongoMemoryReplSet).
 *
 * If RabbitMQ is NOT reachable, the whole suite SKIPS (describe.skip) rather than failing —
 * so it never breaks CI on machines without a broker. Run `npm run infra:up` (or start the
 * microservices stack) to make it execute for real.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Connection, Model } from 'mongoose';
import * as amqplib from 'amqplib';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OutboxMessage, OutboxMessageSchema, OutboxMessageDocument } from './schemas/outbox-message.schema';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelayService } from './outbox-relay.service';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE = 'rocket.orchestrator';
const ROUTING_KEY = 'product.sync.requested';
const TEST_QUEUE = 'q.outbox.delivery.test';

async function brokerReachable(url: string): Promise<boolean> {
  try {
    const conn = await amqplib.connect(url);
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

// Probe synchronously-ish: jest needs the describe decision before running. We resolve the
// probe in beforeAll and skip individual tests if it failed, which is the portable pattern.
describe('Outbox delivery guarantee (integration, requires RabbitMQ)', () => {
  let replset: MongoMemoryReplSet;
  let conn: Connection;
  let model: Model<OutboxMessageDocument>;
  let repo: OutboxRepository;
  let amqp: AmqpConnection;
  let relay: OutboxRelayService;
  let available = false;

  beforeAll(async () => {
    available = await brokerReachable(RABBITMQ_URL);
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn(`[outbox-delivery] RabbitMQ not reachable at ${RABBITMQ_URL} — skipping delivery integration tests.`);
      return;
    }

    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const m = await connect(replset.getUri());
    conn = m.connection;
    model = conn.model(OutboxMessage.name, OutboxMessageSchema) as any;
    repo = new OutboxRepository(model);

    amqp = new AmqpConnection({
      uri: RABBITMQ_URL,
      connectionInitOptions: { wait: true, timeout: 10000 },
      exchanges: [{ name: EXCHANGE, type: 'topic', options: { durable: true } }],
    });
    await amqp.init();

    // Bind a temporary queue so we can observe the published message.
    const channel = amqp.channel;
    await channel.assertQueue(TEST_QUEUE, { durable: false, autoDelete: true });
    await channel.bindQueue(TEST_QUEUE, EXCHANGE, ROUTING_KEY);
    await channel.purgeQueue(TEST_QUEUE);

    relay = new OutboxRelayService(repo, amqp);
  }, 30000);

  afterAll(async () => {
    if (!available) return;
    try { await amqp?.managedConnection?.close(); } catch { /* ignore */ }
    await conn?.close();
    await replset?.stop();
  });

  it('enqueue → relay publishes → doc becomes published AND message lands on the durable queue', async () => {
    if (!available) {
      console.warn('[outbox-delivery] skipped (no broker)');
      return;
    }

    await repo.enqueue({
      exchange: EXCHANGE,
      routingKey: ROUTING_KEY,
      payload: { productId: 'E2E-DELIVERY-1', reason: 'integration_test' },
    });

    // Drive one drain cycle directly (no need to wait on the interval).
    await (relay as any).drainOnce();

    // Doc must be published only after the confirm-channel ack resolved inside drainOnce.
    const doc = await model.findOne({ 'payload.productId': 'E2E-DELIVERY-1' });
    expect(doc).toBeTruthy();
    expect(doc!.status).toBe('published');
    expect(doc!.publishedAt).toBeTruthy();

    // The message must actually be on the broker queue.
    const got = await amqp.channel.get(TEST_QUEUE, { noAck: true });
    expect(got).toBeTruthy();
    const body = JSON.parse((got as amqplib.GetMessage).content.toString());
    expect(body.productId).toBe('E2E-DELIVERY-1');
  }, 30000);

  it('a failed publish never marks the doc published (no lying "published")', async () => {
    if (!available) {
      console.warn('[outbox-delivery] skipped (no broker)');
      return;
    }

    // Enqueue a message whose exchange does not exist → publish path errors out.
    await repo.enqueue({
      exchange: 'exchange.that.does.not.exist',
      routingKey: 'nope',
      payload: { productId: 'E2E-DELIVERY-FAIL', reason: 'integration_test' },
    });

    await (relay as any).drainOnce().catch(() => undefined);

    const doc = await model.findOne({ 'payload.productId': 'E2E-DELIVERY-FAIL' });
    expect(doc).toBeTruthy();
    expect(doc!.status).not.toBe('published');
  }, 30000);
});
