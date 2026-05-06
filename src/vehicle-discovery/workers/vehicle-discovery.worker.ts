import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VehicleDiscoveryService } from '../services/vehicle-discovery.service';
import { VehicleDiscoveryProcessorService } from '../services/vehicle-discovery-processor.service';
import { VEHICLE_CONSTANTS } from '../../vehicle-shared/constants/vehicle.constants';
import { VehicleMetricsService } from '../../vehicle-shared/metrics/vehicle-metrics.service';

@Injectable()
export class VehicleDiscoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleDiscoveryWorker.name);
  private pollInterval: NodeJS.Timeout;
  private isProcessing = false;
  private tickCount = 0;

  constructor(
    private readonly discoveryService: VehicleDiscoveryService,
    private readonly processorService: VehicleDiscoveryProcessorService,
    private readonly metrics: VehicleMetricsService,
  ) {}

  onModuleInit() {
    this.pollInterval = setInterval(() => this.tick(), VEHICLE_CONSTANTS.WORKER_POLL_INTERVAL_MS);
    this.logger.log(
      `VehicleDiscoveryWorker started (poll=${VEHICLE_CONSTANTS.WORKER_POLL_INTERVAL_MS / 1000}s, ` +
      `batch=${VEHICLE_CONSTANTS.WORKER_BATCH_SIZE}, concurrency=${VEHICLE_CONSTANTS.WORKER_AI_CONCURRENCY})`,
    );
  }

  onModuleDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private async tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.discoveryService.recoverStale();
      await this.processBatch();

      this.tickCount += 1;
      if (this.tickCount % 60 === 0) {
        this.metrics.logAndReset();
      }
    } catch (err) {
      this.logger.error(`[VehicleDiscoveryWorker] Unhandled error in poll cycle: ${err?.message}`, err?.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processBatch() {
    const claimed = await this.discoveryService.claimForProcessing(VEHICLE_CONSTANTS.WORKER_BATCH_SIZE);
    if (!claimed.length) return;

    this.logger.log(`Processing batch with ${claimed.length} discoveries`);

    for (const item of claimed) {
      if ((item as any).needsReprocessing) {
        this.metrics.recordReprocessed();
      }
    }

    const limit = VEHICLE_CONSTANTS.WORKER_AI_CONCURRENCY;
    const slots = new Array(limit).fill(Promise.resolve());
    let idx = 0;

    const tasks = claimed.map((discovery) => {
      const slot = idx % limit;
      idx += 1;
      slots[slot] = slots[slot].then(() => this.processorService.processOne(discovery));
      return slots[slot];
    });

    await Promise.all(tasks);
  }
}
