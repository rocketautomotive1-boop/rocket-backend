import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { WebhookInboxDocument, WebhookInboxModel } from './webhook-inbox.schema';
import { WebhookDispatcher } from '../dispatch/webhook-dispatcher.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';

@Injectable()
export class WebhookInboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookInboxWorker.name);
  private readonly owner = randomUUID();
  private running = false;
  private intervalRef?: NodeJS.Timeout;

  constructor(
    @InjectModel(WebhookInboxModel.name) private readonly model: Model<WebhookInboxDocument>,
    private readonly dispatcher: WebhookDispatcher,
    private readonly config: ConfigService,
    private readonly metrics: WebhookMetricsService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => this.safeRun(), 10_000);
    const intervalMs = this.num('WEBHOOK_INBOX_CRON_SECONDS', 30) * 1000;
    this.intervalRef = setInterval(() => this.safeRun(), intervalMs);
  }
  onModuleDestroy(): void { if (this.intervalRef) clearInterval(this.intervalRef); }
  private safeRun() { this.processPending().catch((e) => this.logger.error(`[Inbox] run failed: ${e.message}`)); }

  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseMs = this.num('WEBHOOK_INBOX_LEASE_SECONDS', 300) * 1000;
      const batch = this.num('WEBHOOK_INBOX_BATCH_SIZE', 50);
      const candidates = await this.model.find({
        $or: [
          { status: 'pending', $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
          { status: 'processing', leaseUntil: { $lte: now } },
        ],
      }).sort({ createdAt: 1 }).limit(batch).lean().exec();

      for (const c of candidates) {
        const claimed = await this.model.findOneAndUpdate(
          { _id: (c as any)._id, $or: [{ status: 'pending' }, { status: 'processing', leaseUntil: { $lte: now } }] },
          { status: 'processing', owner: this.owner, leaseUntil: new Date(Date.now() + leaseMs), processingAt: new Date() } as any,
          { new: true },
        );
        if (!claimed) continue;
        await this.processOne(claimed);
      }
    } finally { this.running = false; }
  }

  private async processOne(entry: WebhookInboxDocument): Promise<void> {
    try {
      await this.dispatcher.dispatch({
        marketplace: entry.marketplace, topic: entry.topic, kind: entry.kind as any,
        externalId: entry.externalId, externalUserId: entry.externalUserId, resource: entry.resource, payload: entry.payload, receivedAt: entry.receivedAt ?? new Date(),
      });
      await this.model.findByIdAndUpdate(entry._id, { status: 'done', processedAt: new Date(), lastError: null });
    } catch (err) {
      const attempts = Number(entry.attempts || 0) + 1;
      const max = Number(entry.maxAttempts || 8);
      const dead = attempts >= max;
      await this.model.findByIdAndUpdate(entry._id, {
        status: dead ? 'dead' : 'pending', attempts, lastError: (err as Error).message,
        leaseUntil: null, nextRetryAt: dead ? null : new Date(Date.now() + this.backoff(attempts)),
      });
      if (dead) {
        this.metrics.incDead(entry.marketplace, entry.kind);
        this.logger.error(`[Inbox] DEAD id=${entry._id} eventId=${entry.eventId} attempts=${attempts} err=${(err as Error).message}`);
      } else {
        this.logger.warn(`[Inbox] retry id=${entry._id} attempts=${attempts}/${max}: ${(err as Error).message}`);
      }
    }
  }

  private backoff(attempts: number): number {
    const base = this.num('WEBHOOK_INBOX_RETRY_BASE_MS', 30_000);
    return base * 2 ** (Math.min(attempts, 6) - 1);
  }
  private num(key: string, def: number): number {
    const v = Number(this.config.get(key));
    return Number.isFinite(v) && v > 0 ? v : def;
  }
}
