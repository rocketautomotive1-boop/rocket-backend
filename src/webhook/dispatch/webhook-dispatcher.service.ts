import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WEBHOOK_DOMAIN_COMMANDS } from '../events/webhook.events';
export interface DispatchInput {
  marketplace: string; topic: string;
  kind: 'order' | 'order_pack' | 'question' | 'moderation' | 'unparseable';
  externalId?: string; externalUserId?: string; resource?: string; payload: any; receivedAt: Date;
}
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);
  constructor(private readonly emitter: EventEmitter2) {}
  async dispatch(input: DispatchInput): Promise<void> {
    if (input.kind === 'unparseable') return;
    if (!input.externalId) { this.logger.warn(`[Dispatch] ${input.marketplace}/${input.topic} kind=${input.kind} sem externalId`); return; }
    switch (input.kind) {
      case 'order':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, { marketplace: input.marketplace, externalOrderId: input.externalId, externalUserId: input.externalUserId ?? null, resource: input.resource ?? null, receivedAt: input.receivedAt, source: 'webhook' });
        return;
      case 'order_pack':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED, { marketplace: input.marketplace, externalPackId: input.externalId, externalUserId: input.externalUserId ?? null, resource: input.resource, receivedAt: input.receivedAt, source: 'webhook' });
        return;
      case 'question':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.QUESTION_INGEST_REQUESTED, { marketplace: input.marketplace, externalQuestionId: input.externalId, resource: input.resource, receivedAt: input.receivedAt });
        return;
      case 'moderation':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.MODERATION_PROBE_REQUESTED, { marketplace: input.marketplace, externalId: input.externalId, externalUserId: input.externalUserId ?? null, resource: input.resource ?? null, receivedAt: input.receivedAt, source: 'webhook' });
        return;
    }
  }
}
