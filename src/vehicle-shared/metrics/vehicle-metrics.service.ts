import { Injectable, Logger } from '@nestjs/common';
import { VehicleApprovalTier } from '../constants/vehicle.constants';

export interface MetricsSnapshot {
  totalProcessed: number;
  totalFailed: number;
  totalReprocessed: number;
  aiCalls: number;
  aiCacheHits: number;
  aiCacheHitRatio: number;
  duplicatesAvoided: number;
  approvalsByTier: Record<string, number>;
  avgProcessingTimeMs: number;
  errorsByType: Record<string, number>;
  windowStartedAt: Date;
}

@Injectable()
export class VehicleMetricsService {
  private readonly logger = new Logger(VehicleMetricsService.name);

  private totalProcessed = 0;
  private totalFailed = 0;
  private totalReprocessed = 0;
  private aiCalls = 0;
  private aiCacheHits = 0;
  private duplicatesAvoided = 0;
  private approvalsByTier: Record<string, number> = {};
  private processingTimeSamples: number[] = [];
  private errorsByType: Record<string, number> = {};
  private windowStartedAt = new Date();

  recordAiCall() { this.aiCalls++; }
  recordCacheHit() { this.aiCacheHits++; }
  recordReprocessed() { this.totalReprocessed++; }
  recordDuplicateAvoided() { this.duplicatesAvoided++; }

  recordProcessed(durationMs: number) {
    this.totalProcessed++;
    this.processingTimeSamples.push(durationMs);
    if (this.processingTimeSamples.length > 200) this.processingTimeSamples.shift();
  }

  recordFailed(errorType: string) {
    this.totalFailed++;
    this.errorsByType[errorType] = (this.errorsByType[errorType] ?? 0) + 1;
  }

  recordApproval(tier: VehicleApprovalTier | 'manual' | 'rejected') {
    this.approvalsByTier[tier] = (this.approvalsByTier[tier] ?? 0) + 1;
  }

  snapshot(): MetricsSnapshot {
    const totalAi = this.aiCalls + this.aiCacheHits;
    const avgMs =
      this.processingTimeSamples.length > 0
        ? this.processingTimeSamples.reduce((a, b) => a + b, 0) / this.processingTimeSamples.length
        : 0;

    return {
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      totalReprocessed: this.totalReprocessed,
      aiCalls: this.aiCalls,
      aiCacheHits: this.aiCacheHits,
      aiCacheHitRatio: totalAi ? this.aiCacheHits / totalAi : 0,
      duplicatesAvoided: this.duplicatesAvoided,
      approvalsByTier: { ...this.approvalsByTier },
      avgProcessingTimeMs: Math.round(avgMs),
      errorsByType: { ...this.errorsByType },
      windowStartedAt: this.windowStartedAt,
    };
  }

  reset() {
    this.totalProcessed = 0;
    this.totalFailed = 0;
    this.totalReprocessed = 0;
    this.aiCalls = 0;
    this.aiCacheHits = 0;
    this.duplicatesAvoided = 0;
    this.approvalsByTier = {};
    this.processingTimeSamples = [];
    this.errorsByType = {};
    this.windowStartedAt = new Date();
  }

  logAndReset() {
    const snap = this.snapshot();
    this.logger.log(
      `[VehicleMetrics] processed=${snap.totalProcessed} failed=${snap.totalFailed} ` +
      `reprocessed=${snap.totalReprocessed} aiCalls=${snap.aiCalls} cacheHits=${snap.aiCacheHits} ` +
      `duplicatesAvoided=${snap.duplicatesAvoided} avgMs=${snap.avgProcessingTimeMs}`,
    );
    this.reset();
  }
}
