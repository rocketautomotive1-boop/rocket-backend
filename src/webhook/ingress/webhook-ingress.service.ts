import { Injectable, Logger } from '@nestjs/common';
import { WebhookAdapter, WebhookContext } from '../adapters/webhook-adapter.interface';
import { WebhookInboxService } from '../inbox/webhook-inbox.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';

@Injectable()
export class WebhookIngressService {
  private readonly logger = new Logger(WebhookIngressService.name);
  constructor(private readonly inbox: WebhookInboxService, private readonly metrics: WebhookMetricsService) {}
  async ingest(adapter: WebhookAdapter, ctx: WebhookContext): Promise<{ success: true }> {
    if (ctx.payload?.Type === 'SubscriptionConfirmation' && adapter.confirmSubscription && ctx.payload?.SubscribeURL) {
      await adapter.confirmSubscription(ctx.payload.SubscribeURL);
      return { success: true };
    }
    let normalized;
    try {
      normalized = adapter.parse(ctx);
    } catch (err) {
      const eventId = `${ctx.marketplace}:${ctx.topic}:unparseable:${Date.now()}`;
      await this.inbox.appendDead(ctx.marketplace, ctx.topic, eventId, ctx.payload, (err as Error).message);
      this.logger.error(`[Ingress] parse falhou ${ctx.marketplace}/${ctx.topic}: ${(err as Error).message}`);
      return { success: true };
    }
    if (normalized.kind === 'ignore') return { success: true };
    const idRequiringKinds = ['order', 'order_pack', 'shipment', 'question', 'moderation', 'return'];
    if (
      idRequiringKinds.includes(normalized.kind) &&
      (!normalized.externalId || normalized.externalId.trim() === '')
    ) {
      const deadEventId =
        normalized.eventId && !normalized.eventId.endsWith(':')
          ? normalized.eventId
          : `${ctx.marketplace}:${ctx.topic}:missing-id:${Date.now()}`;
      await this.inbox.appendDead(
        ctx.marketplace,
        ctx.topic,
        deadEventId,
        ctx.payload,
        `externalId ausente para kind=${normalized.kind}`,
      );
      this.logger.error(
        `[Ingress] externalId ausente ${ctx.marketplace}/${ctx.topic} kind=${normalized.kind} — descartado (dead)`,
      );
      return { success: true };
    }
    await this.inbox.append(ctx.marketplace, ctx.topic, normalized);
    this.metrics.incReceived(ctx.marketplace, normalized.kind);
    return { success: true };
  }
}
