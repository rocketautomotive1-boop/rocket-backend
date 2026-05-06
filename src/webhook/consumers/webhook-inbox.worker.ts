import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WebhookInboxDocument,
  WebhookInboxModel,
} from '../schemas/webhook-inbox.schema';
import {
  WebhookOrderDispatcher,
  WebhookReceivedEvent,
} from './webhook-order-dispatcher.service';

@Injectable()
export class WebhookInboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookInboxWorker.name);
  private running = false;
  private intervalRef?: NodeJS.Timeout;

  constructor(
    @InjectModel(WebhookInboxModel.name)
    private readonly webhookInboxModel: Model<WebhookInboxDocument>,
    private readonly webhookDispatcher: WebhookOrderDispatcher,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    setTimeout(() => {
      this.processPending().catch((err) =>
        this.logger.error(`[InboxWorker] Startup run failed: ${err.message}`),
      );
    }, 10_000);

    const intervalMs = this.getNumberEnv('WEBHOOK_INBOX_CRON_SECONDS', 60) * 1000;
    this.intervalRef = setInterval(() => {
      this.processPending().catch((err) =>
        this.logger.error(`[InboxWorker] Interval run failed: ${err.message}`),
      );
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }

  async processPending(): Promise<void> {
    if (!this.getBooleanEnv('WEBHOOK_INBOX_ENABLED', true)) return;
    if (this.running) return;
    this.running = true;

    try {
      const batchSize = this.getNumberEnv('WEBHOOK_INBOX_BATCH_SIZE', 50);
      const now = new Date();
      const entries = await this.webhookInboxModel
        .find({
          status: { $in: ['pending', 'processing'] },
          $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }],
        })
        .sort({ createdAt: 1 })
        .limit(batchSize)
        .lean()
        .exec();

      for (const entry of entries) {
        const claimed = await this.webhookInboxModel.findOneAndUpdate(
          {
            _id: entry._id,
            status: { $in: ['pending', 'processing'] },
          },
          {
            status: 'processing',
            processingAt: new Date(),
          },
          { new: true },
        );

        if (!claimed) continue;
        await this.processOne(claimed);
      }
    } finally {
      this.running = false;
    }
  }

  private async processOne(entry: WebhookInboxDocument): Promise<void> {
    const event: WebhookReceivedEvent = {
      marketplace: entry.marketplace,
      topic: entry.topic,
      payload: entry.payload,
    };

    try {
      await this.webhookDispatcher.dispatchWebhookEvent(event);
      await this.webhookInboxModel.findByIdAndUpdate(entry._id, {
        status: 'done',
        processedAt: new Date(),
        lastError: null,
      });
    } catch (err) {
      const attempts = Number(entry.attempts || 0) + 1;
      const maxAttempts = Number(entry.maxAttempts || this.getNumberEnv('WEBHOOK_INBOX_MAX_ATTEMPTS', 8));
      const exhausted = attempts >= maxAttempts;
      const retryDelayMs = this.computeBackoffMs(attempts);

      await this.webhookInboxModel.findByIdAndUpdate(entry._id, {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        lastError: (err as Error).message,
        nextRetryAt: exhausted ? null : new Date(Date.now() + retryDelayMs),
      });

      this.logger.warn(
        `[InboxWorker] Failed processing inbox=${entry._id} attempts=${attempts}/${maxAttempts}: ${(err as Error).message}`,
      );
    }
  }

  private computeBackoffMs(attempts: number): number {
    const base = this.getNumberEnv('WEBHOOK_INBOX_RETRY_BASE_MS', 30_000);
    const cappedAttempts = Math.min(attempts, 6);
    return base * 2 ** (cappedAttempts - 1);
  }

  private getBooleanEnv(key: string, defaultValue: boolean): boolean {
    const raw = this.configService.get<string | boolean | undefined>(key);
    if (typeof raw === 'boolean') return raw;
    if (raw == null) return defaultValue;

    const normalized = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
  }

  private getNumberEnv(key: string, defaultValue: number): number {
    const raw = this.configService.get<string | number | undefined>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }
}
