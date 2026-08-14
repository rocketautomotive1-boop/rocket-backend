import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WebhookInboxDocument, WebhookInboxModel } from './webhook-inbox.schema';
import { NormalizedWebhook } from '../adapters/webhook-adapter.interface';
@Injectable()
export class WebhookInboxService {
  private readonly logger = new Logger(WebhookInboxService.name);
  constructor(@InjectModel(WebhookInboxModel.name) private readonly model: Model<WebhookInboxDocument>) {}
  async append(marketplace: string, topic: string, n: NormalizedWebhook): Promise<{ record: WebhookInboxDocument; isNew: boolean }> {
    try {
      const record = await this.model.create({
        marketplace, topic, kind: n.kind === 'ignore' ? 'unparseable' : n.kind,
        eventId: n.eventId, externalId: n.externalId, externalUserId: n.externalUserId, resource: n.resource,
        payload: n.raw, status: 'pending', attempts: 0, maxAttempts: 8,
        receivedAt: new Date(), nextRetryAt: new Date(),
      });
      return { record, isNew: true };
    } catch (err: any) {
      if (err?.code === 11000) {
        const existing = await this.model.findOne({ eventId: n.eventId }).exec();
        if (existing) return { record: existing, isNew: false };
      }
      throw err;
    }
  }
  async appendDead(marketplace: string, topic: string, eventId: string, payload: any, error: string): Promise<void> {
    try {
      await this.model.create({ marketplace, topic, kind:'unparseable', eventId, payload, status:'dead', attempts:0, maxAttempts:0, receivedAt:new Date(), lastError:error });
    } catch (err: any) { if (err?.code !== 11000) throw err; }
  }
}
