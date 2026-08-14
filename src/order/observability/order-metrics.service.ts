import { Injectable } from '@nestjs/common';

/**
 * Lightweight in-memory counters for order ingestion + reconcile, mirroring the shape of
 * webhook-metrics.service. Exposed via GET /orders/reconcile/health for health checks and
 * alerting ("reconciler finding many gaps" = webhook degraded).
 */
@Injectable()
export class OrderMetricsService {
  private ingestBySource = new Map<string, number>();
  private gaps = new Map<string, number>();
  private reconcileRuns = 0;

  incIngest(source: string): void {
    this.ingestBySource.set(source, (this.ingestBySource.get(source) ?? 0) + 1);
  }

  incGapDetected(kind: string): void {
    this.gaps.set(kind, (this.gaps.get(kind) ?? 0) + 1);
  }

  incReconcileRun(): void {
    this.reconcileRuns++;
  }

  snapshot() {
    return {
      ingestBySource: Object.fromEntries(this.ingestBySource),
      gaps: Object.fromEntries(this.gaps),
      reconcileRuns: this.reconcileRuns,
    };
  }
}
