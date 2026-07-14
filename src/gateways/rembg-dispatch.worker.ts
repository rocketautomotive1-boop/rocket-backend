import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';
import { RembgCompletionService } from './rembg-completion.service';

/** How long a claimed (dispatched) job is leased before it's considered orphaned. */
const LEASE_TTL_MS = 5 * 60 * 1000; // 5 min — covers a slow Photoroom call + callback
/** Max jobs dispatched per tick (bounded fan-out). */
const BATCH_SIZE = 5;

/**
 * Durable dispatcher for rembg jobs. The RembgJob collection IS the queue — no RabbitMQ,
 * no in-memory timers. Each tick atomically claims eligible jobs and hands the work to the
 * microservice over HTTP; the microservice reports back via the idempotent result callback.
 *
 * Eligibility (crash-safe):
 *   - status 'pending' with nextRetryAt in the past (or null)  → new work / due retry
 *   - status 'dispatched' with leaseExpiresAt in the past      → orphaned (worker/service
 *                                                                 crashed) → reclaim
 *
 * Because the claim is a single atomic findOneAndUpdate, two workers never claim the same
 * job. This is what makes a stuck 'processing' slot impossible: every reserved slot has a
 * durable job that will keep being reclaimed until it reaches done|failed.
 */
@Injectable()
export class RembgDispatchWorker {
  private readonly logger = new Logger(RembgDispatchWorker.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    private readonly completion: RembgCompletionService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const job = await this.claimNext();
      if (!job) return;
      // Fire the dispatch but don't let one slow HTTP call stall the batch loop.
      void this.dispatch(job);
    }
  }

  /** Atomically claim one eligible job, leasing it so no other worker takes it. */
  private async claimNext(): Promise<RembgJobDocument | null> {
    const now = new Date();
    return this.rembgJobModel.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }] },
          { status: 'dispatched', leaseExpiresAt: { $lte: now } },
        ],
      },
      // Claiming does NOT consume an attempt — `attempts` counts real PROCESSING failures
      // (reported by the microservice), not deliveries/reclaims. This keeps a restarting
      // service or a lease reclaim from burning a slot's retry budget.
      { $set: { status: 'dispatched', leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) } },
      { new: true, sort: { nextRetryAt: 1, createdAt: 1 } },
    );
  }

  /**
   * Hand the job to the microservice. This request only DELIVERS the work — it does not
   * wait for background removal to finish. The microservice processes and calls back.
   * A delivery failure (service down) is a failed attempt → durable retry via completion.
   */
  private async dispatch(job: RembgJobDocument): Promise<void> {
    const rembgUrl = (this.config.get<string>('REMBG_URL') || 'http://localhost:8000').replace(/\/$/, '');
    const backendUrl = (this.config.get<string>('PUBLIC_BACKEND_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const internalKey = this.config.get<string>('INTERNAL_API_KEY') || '';

    try {
      const resp = await fetch(`${rembgUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: String(job._id),
          productId: job.productId,
          rawKey: job.rawS3Key,
          batchCode: job.batchCode,
          batchNote: job.batchNote,
          options: job.options ?? {},
          callbackUrl: `${backendUrl}/internal/rembg/result`,
          callbackKey: internalKey,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`rembg /process returned ${resp.status}: ${text.slice(0, 200)}`);
      }
      // Accepted — the microservice now owns the job until it calls back. The lease
      // guarantees we reclaim it if that callback never arrives.
      this.logger.debug(`Dispatched rembg job ${job._id} (slot ${job.slotId})`);
    } catch (err: any) {
      this.logger.warn(`Dispatch failed for job ${job._id}: ${err.message}`);
      // Delivery failure (service down/wrong) — requeue without consuming an attempt.
      await this.completion.applyDeliveryFailure(String(job._id), err.message);
    }
  }
}
