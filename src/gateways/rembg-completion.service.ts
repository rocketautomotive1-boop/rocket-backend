import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';
import { RembgGateway } from './rembg.gateway';
import { ProcessedImageService } from '../processed-image/processed-image.service';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { S3Service } from '../common/s3/s3.service';
import { REMBG_EVENTS } from './rembg.events';
import {
  PRODUCT_SECTION_EVENTS,
  ProductImagesSavedEvent,
} from '../product/events/product-section-saved.event';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
/** Short backoff for delivery failures (service down) — does not consume an attempt. */
const DELIVERY_RETRY_DELAY_MS = 15_000;

export interface RembgSuccessResult {
  url: string;
  key: string;
  source?: string | null;
}

/**
 * Owns the CONCLUSION of a rembg job — the single, idempotent place where a job
 * reaches a terminal state. Both the HTTP result callback and the reconciler funnel
 * through here so the "never lose credit, never double-charge, always converge"
 * invariants live in exactly one code path.
 *
 * Success order is deliberate: persist the repository row FIRST (the paid artifact),
 * then fill the product slot, then mark the job done. A crash between any two steps is
 * safe because every step is idempotent (upsert by jobId, positional $set by slotId).
 */
@Injectable()
export class RembgCompletionService {
  private readonly logger = new Logger(RembgCompletionService.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly processedImageService: ProcessedImageService,
    private readonly rembgGateway: RembgGateway,
    private readonly s3Service: S3Service,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Fill a reserved slot with the processed result (atomic positional update by slotId). */
  private async fillSlot(productId: string, slotId: string, url: string, key: string): Promise<void> {
    await this.productModel.updateOne(
      { _id: productId, 'images.slotId': slotId },
      {
        $set: {
          'images.$.url': url,
          'images.$.key': key,
          'images.$.mimeType': 'image/png',
          'images.$.status': 'active',
        },
      },
    );
  }

  /** Mark a reserved slot failed (keeps its position; UI surfaces it). */
  async markSlotFailed(productId: string, slotId: string): Promise<void> {
    await this.productModel.updateOne(
      { _id: productId, 'images.slotId': slotId },
      { $set: { 'images.$.status': 'failed' } },
    );
  }

  /** Idempotent success: record the paid image, fill the slot, close the job. */
  async applySuccess(jobId: string, result: RembgSuccessResult): Promise<void> {
    const job = await this.rembgJobModel.findById(jobId);
    if (!job) {
      this.logger.warn(`applySuccess: job ${jobId} not found — ignoring`);
      return;
    }
    if (job.status === 'done') {
      // Duplicate/late callback — nothing to do (idempotent no-op).
      return;
    }

    // 1) Repository first — the paid artifact, upserted by jobId (exactly once).
    const saved = await this.processedImageService.saveProcessedImage({
      jobId,
      batchCode: job.batchCode,
      batchNote: job.batchNote,
      productId: job.productId,
      url: result.url,
      key: result.key,
      mimeType: 'image/png',
      source: result.source ?? job.source ?? null,
    });

    // 2) Fill the reserved slot in place (positional, idempotent by slotId).
    await this.fillSlot(job.productId, job.slotId, result.url, result.key);

    // 3) Close the job.
    await this.rembgJobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'done',
          processedImageKey: result.key,
          processedImageId: saved.id,
          source: result.source ?? job.source ?? null,
          leaseExpiresAt: null,
          nextRetryAt: null,
          lastError: null,
        },
      },
    );

    // 4) Best-effort cleanup of the raw upload — never blocks completion.
    if (job.rawS3Key) {
      await this.s3Service.deleteFile(job.rawS3Key).catch((e) =>
        this.logger.warn(`Failed to delete raw S3 file ${job.rawS3Key}: ${e.message}`),
      );
    }

    this.rembgGateway.server.emit('rembg:job:done', {
      productId: job.productId,
      jobId,
      slotId: job.slotId,
      imageUrl: result.url,
      key: result.key,
    });

    await this.emitBatchState(job.productId, job.batchCode);
    this.logger.log(`Rembg job ${jobId} (slot ${job.slotId}) completed`);
  }

  /**
   * DELIVERY failure — the microservice was unreachable/wrong (connection refused, 404,
   * 5xx from the HTTP dispatch itself). This is NOT the image's fault, so it must NOT burn
   * a processing attempt or fail the slot: a rembg that is restarting/redeploying would
   * otherwise kill perfectly good slots (exactly what happened to slot 0). Re-queue with a
   * short backoff and let the poller try again once the service is back.
   */
  async applyDeliveryFailure(jobId: string, message: string): Promise<void> {
    const job = await this.rembgJobModel.findById(jobId);
    if (!job) return;
    if (job.status === 'done' || job.status === 'failed') return;

    await this.rembgJobModel.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'pending',
          nextRetryAt: new Date(Date.now() + DELIVERY_RETRY_DELAY_MS),
          leaseExpiresAt: null,
          lastError: `delivery: ${message}`,
        },
      },
    );
    this.logger.warn(`Rembg job ${jobId} delivery failed (no attempt consumed): ${message} — requeued`);
  }

  /**
   * PROCESSING failure — the microservice ran and reported an error. A `permanent` error
   * (unusable source image) fails terminally at once: reprocessing can't succeed, so we
   * never retry, never loop, never spend more credits. A transient error consumes an
   * attempt and retries with backoff; after MAX_ATTEMPTS it fails terminally.
   */
  async applyFailure(jobId: string, message: string, permanent = false): Promise<void> {
    const job = await this.rembgJobModel.findById(jobId);
    if (!job) {
      this.logger.warn(`applyFailure: job ${jobId} not found — ignoring`);
      return;
    }
    if (job.status === 'done' || job.status === 'failed') return;

    const attempts = (job.attempts ?? 0) + 1;
    if (!permanent && attempts < MAX_ATTEMPTS) {
      const delayMs = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ?? 120_000;
      await this.rembgJobModel.updateOne(
        { _id: jobId },
        {
          $set: {
            status: 'pending',
            nextRetryAt: new Date(Date.now() + delayMs),
            leaseExpiresAt: null,
            lastError: message,
          },
          $inc: { attempts: 1 },
        },
      );
      this.logger.warn(`Rembg job ${jobId} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message} — retry in ${delayMs}ms`);
      return;
    }

    // Terminal: keep the slot's position but mark it failed so the UI can surface it.
    await this.rembgJobModel.updateOne(
      { _id: jobId },
      {
        $set: { status: 'failed', leaseExpiresAt: null, nextRetryAt: null, lastError: message, permanentFailure: permanent },
        $inc: { attempts: 1 },
      },
    );
    await this.markSlotFailed(job.productId, job.slotId).catch(() => {});

    this.rembgGateway.server.emit('rembg:job:failed', {
      productId: job.productId,
      jobId,
      slotId: job.slotId,
      attempt: attempts,
      permanent,
    });
    await this.emitBatchState(job.productId, job.batchCode);
    this.logger.error(
      `Rembg job ${jobId} terminally failed${permanent ? ' (permanent)' : ` after ${attempts} attempts`}: ${message}`,
    );
  }

  /**
   * Source of truth for batch progress = the RembgJob docs of the batch.
   * Emits `rembg:batch:progress` always, and `rembg:batch:done` once every job in the
   * batch reached a terminal state. These are the events useRembgProductRealtime consumes.
   */
  async emitBatchState(productId: string, batchCode: string): Promise<void> {
    const jobs = await this.rembgJobModel
      .find({ productId, batchCode })
      .select('status')
      .lean();

    const total = jobs.length;
    const done = jobs.filter((j) => j.status === 'done').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const completed = total > 0 && done + failed === total;

    this.rembgGateway.server.emit('rembg:batch:progress', {
      productId,
      batchCode,
      total,
      done,
      failed,
      completed,
    });

    if (completed) {
      this.rembgGateway.server.emit('rembg:batch:done', {
        productId,
        batchCode,
        total,
        done,
        failed,
      });

      // Close the readiness loop. rembg completing is an ASYNC change to the product's
      // image state that no section-save emits — so without this, the product's readiness
      // never gets recomputed and the publish gate/auto-publish stay stuck on the last
      // value (the "product never publishes after rembg finishes" bug). Emitting
      // IMAGES_SAVED lets ProductReadinessService recompute → persist the marker → fire
      // BECAME_READY on the false→true edge → auto-publish. compute() remains the single
      // source of truth; this is just the trigger that tells it to re-run.
      this.eventEmitter.emit(
        PRODUCT_SECTION_EVENTS.IMAGES_SAVED,
        new ProductImagesSavedEvent(productId),
      );
    }
  }

  /**
   * Reconcile a (re)connecting client with the CURRENT batch state of a product.
   *
   * The batch events (`rembg:batch:progress` / `:done`) are fire-and-forget broadcasts:
   * a client that was disconnected when a batch finished never receives the terminal
   * event and would otherwise stay stuck on "processing" forever even though the jobs
   * already reached a terminal state in the DB. When a client subscribes to a product,
   * the gateway emits `REMBG_SUBSCRIBED` and we replay the current state of every batch
   * of that product INTO THAT PRODUCT'S ROOM, making the socket self-healing.
   *
   * We recompute state per batch exactly as `emitBatchState` does, but target the room
   * (only the subscribers of this product) instead of a global broadcast.
   */
  @OnEvent(REMBG_EVENTS.SUBSCRIBED)
  async reconcileProduct(payload: { productId: string }): Promise<void> {
    const productId = String(payload?.productId ?? '').trim();
    if (!productId) return;

    const jobs = await this.rembgJobModel
      .find({ productId })
      .select('batchCode status')
      .lean();
    if (!jobs.length) return;

    const room = this.rembgGateway.server.to(`product_${productId}`);
    const batchCodes = [...new Set(jobs.map((j) => j.batchCode))];

    for (const batchCode of batchCodes) {
      const batchJobs = jobs.filter((j) => j.batchCode === batchCode);
      const total = batchJobs.length;
      const done = batchJobs.filter((j) => j.status === 'done').length;
      const failed = batchJobs.filter((j) => j.status === 'failed').length;
      const completed = total > 0 && done + failed === total;

      room.emit('rembg:batch:progress', { productId, batchCode, total, done, failed, completed });
      if (completed) {
        room.emit('rembg:batch:done', { productId, batchCode, total, done, failed });
      }
    }
  }
}
