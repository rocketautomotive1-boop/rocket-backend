import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OutboxRepository } from './outbox.repository';

const POLL_MS = Number(process.env.OUTBOX_POLL_MS) || 1000;
const BATCH_SIZE = 20;
const STALE_PUBLISHING_MS = 2 * 60 * 1000;
const RECOVERY_EVERY_N = 30;
const BACKOFF_SECONDS = [5, 15, 30, 60, 120, 300];

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private cycle = 0;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly amqp: AmqpConnection,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.drainOnce().catch(e => this.logger.error(`relay tick failed: ${e.message}`)), POLL_MS);
    this.logger.log('OutboxRelayService started');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private backoff(attempts: number): number {
    return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
  }

  private async drainOnce(): Promise<void> {
    this.cycle++;
    if (this.cycle % RECOVERY_EVERY_N === 0) {
      const n = await this.repo.recoverStalePublishing(STALE_PUBLISHING_MS);
      if (n > 0) this.logger.warn(`Recovered ${n} stale publishing outbox messages`);
    }

    const batch = await this.repo.claimBatch(BATCH_SIZE, new Date());
    if (!batch.length) return;

    await Promise.all(batch.map(async (msg) => {
      const id = String(msg._id);
      try {
        await this.amqp.publish(msg.exchange, msg.routingKey, msg.payload, { persistent: true });
        await this.repo.markPublished(id);
      } catch (err: any) {
        await this.repo.markFailedOrReschedule(id, msg.attempts ?? 0, err.message, this.backoff(msg.attempts ?? 0));
      }
    }));
  }
}
