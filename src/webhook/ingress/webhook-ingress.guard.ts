import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WebhookAdapterRegistry } from '../adapters/webhook-adapter.registry';
import { SignatureVerifier } from '../crypto/signature-verifier.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';
import { buildWebhookContext } from './webhook-context';

@Injectable()
export class WebhookIngressGuard implements CanActivate {
  constructor(
    private readonly registry: WebhookAdapterRegistry,
    private readonly verifier: SignatureVerifier,
    private readonly metrics: WebhookMetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ctx = buildWebhookContext(req);
    const adapter = this.registry.get(ctx.marketplace);
    if (!adapter) {
      this.metrics.incRejected(ctx.marketplace || 'unknown', 'unknown_marketplace');
      throw new NotFoundException(`Webhook marketplace desconhecido: ${ctx.marketplace}`);
    }
    const ok = await this.verifier.verify(adapter.signatureScheme, ctx);
    if (!ok) {
      this.metrics.incRejected(ctx.marketplace, 'bad_signature');
      throw new UnauthorizedException('Assinatura de webhook inválida');
    }
    req.webhookAdapter = adapter;
    req.webhookContext = ctx;
    return true;
  }
}
