import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RembgJobDocument = HydratedDocument<RembgJob>;

/**
 * Durable job for one product image slot's background removal.
 *
 * This document IS the queue — there is no RabbitMQ in the rembg flow. A @Cron
 * worker claims work atomically; the microservice reports back over an idempotent
 * HTTP callback. Lifecycle:
 *   pending → dispatched → done | failed
 *
 * Crash recovery: a `dispatched` job whose `leaseExpiresAt` has passed is treated
 * as reclaimable — the worker picks it up again. `nextRetryAt` gates retries after
 * a failure (durable backoff, replaces the old in-memory setTimeout).
 */
@Schema({ collection: 'rembg_jobs', timestamps: true })
export class RembgJob {
  @Prop({ required: true, index: true })
  productId: string;

  /** Raw (unprocessed) upload key in S3. The microservice downloads this directly. */
  @Prop({ required: true })
  rawS3Key: string;

  @Prop({ required: true, index: true })
  batchCode: string;

  /** Stable identity of the reserved product image slot this job fills on completion. */
  @Prop({ required: true, index: true })
  slotId: string;

  @Prop({ default: null })
  batchNote: string | null;

  /** Processing options forwarded verbatim to the microservice (provider, crop, etc.). */
  @Prop({ type: Object, default: null })
  options: Record<string, any> | null;

  @Prop({
    type: String,
    enum: ['pending', 'dispatched', 'done', 'failed'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'dispatched' | 'done' | 'failed';

  @Prop({ default: 0 })
  attempts: number;

  /** Next time a `pending` job is eligible for claim (durable backoff). */
  @Prop({ default: null })
  nextRetryAt: Date | null;

  /** While `dispatched`, the lease deadline. Past it → reclaimable (crash recovery). */
  @Prop({ default: null })
  leaseExpiresAt: Date | null;

  /** S3 key of the processed PNG (set on success, before the slot is filled). */
  @Prop({ default: null })
  processedImageKey: string | null;

  /** Repository (ProcessedImage) document id created for this job. */
  @Prop({ default: null })
  processedImageId: string | null;

  /** Provider/model that produced the result (e.g. 'photoroom', 'isnet-general-use'). */
  @Prop({ default: null })
  source: string | null;

  /** Last error message when a dispatch/processing attempt failed. */
  @Prop({ default: null })
  lastError: string | null;

  /**
   * True when the job failed for a PERMANENT reason (unusable source image). The reconciler
   * must never re-queue a permanently-failed slot — reprocessing can't succeed and would
   * loop/waste credits. Transient failures leave this false and stay retryable.
   */
  @Prop({ default: false })
  permanentFailure: boolean;
}

export const RembgJobSchema = SchemaFactory.createForClass(RembgJob);

// Claim query index: pending due for retry, or dispatched with expired lease.
RembgJobSchema.index({ status: 1, nextRetryAt: 1, leaseExpiresAt: 1 });
