import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import {
  WebhookInboxDocument,
  WebhookInboxModel,
} from '../schemas/webhook-inbox.schema';

interface StoreWebhookInput {
  marketplace: string;
  topic: string;
  payload: any;
}

@Injectable()
export class WebhookInboxService {
  private readonly logger = new Logger(WebhookInboxService.name);

  constructor(
    @InjectModel(WebhookInboxModel.name)
    private readonly webhookInboxModel: Model<WebhookInboxDocument>,
    private readonly configService: ConfigService,
  ) {}

  async store(input: StoreWebhookInput): Promise<{ record: WebhookInboxDocument; isNew: boolean }> {
    const dedupeKey = this.buildDedupeKey(input.marketplace, input.topic, input.payload);
    const maxAttempts = this.getNumberEnv('WEBHOOK_INBOX_MAX_ATTEMPTS', 8);
    const existing = await this.webhookInboxModel.findOne({ dedupeKey }).exec();
    if (existing) {
      this.logger.debug(
        `[Inbox] Duplicate webhook ignored (${input.marketplace}/${input.topic}) dedupe=${dedupeKey}`,
      );
      return { record: existing, isNew: false };
    }

    try {
      const record = await this.webhookInboxModel.create({
        marketplace: input.marketplace,
        topic: input.topic,
        payload: input.payload,
        dedupeKey,
        status: 'pending',
        attempts: 0,
        maxAttempts,
        nextRetryAt: new Date(),
      });
      return { record, isNew: true };
    } catch (err: any) {
      if (err?.code === 11000) {
        const duplicate = await this.webhookInboxModel.findOne({ dedupeKey }).exec();
        if (!duplicate) throw err;
        this.logger.debug(
          `[Inbox] Duplicate webhook ignored (${input.marketplace}/${input.topic}) dedupe=${dedupeKey}`,
        );
        return { record: duplicate, isNew: false };
      }
      throw err;
    }
  }

  isEnabledForMarketplace(marketplace: string): boolean {
    const enabled = this.getBooleanEnv('WEBHOOK_INBOX_ENABLED', true);
    if (!enabled) return false;

    const raw = this.configService.get<string>('WEBHOOK_INBOX_MARKETPLACES', 'mercadolivre');
    const allowed = raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    return allowed.includes(marketplace.toLowerCase());
  }

  private buildDedupeKey(marketplace: string, topic: string, payload: any): string {
    const material = JSON.stringify({
      marketplace,
      topic,
      resource: payload?.resource ?? null,
      userId: payload?.user_id ?? payload?.userId ?? null,
      applicationId: payload?.application_id ?? payload?.applicationId ?? null,
      sent: payload?.sent ?? payload?.date_created ?? null,
      raw: payload,
    });
    return createHash('sha256').update(material).digest('hex');
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
