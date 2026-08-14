import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';
import { RembgCompletionService } from './rembg-completion.service';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { S3Service } from '../common/s3/s3.service';

interface StuckSlot {
  productId: string;
  slotId: string;
  status: 'processing' | 'failed';
  url?: string;
  key?: string;
}

/**
 * Repairs reserved image slots that are stuck in 'processing' but have no live job to
 * finish them — the exact failure that left products frozen at "Removendo fundo" forever.
 *
 * What it heals (slots in 'processing' OR 'failed'):
 *   1) A slot whose job already succeeded but the slot missed the fill — re-apply.
 *   2) A slot with a live job — leave it to the dispatcher.
 *   3) A slot with no live job whose RAW STILL EXISTS in S3 — recreate a pending job and
 *      put the slot back to 'processing'. This retries a slot that failed only because the
 *      microservice was down (delivery 404/refused), since the credit was never spent and
 *      the original image is still there. Idempotent by jobId, so it never double-charges.
 *   4) A slot with no live job and no raw in S3 — fail it (nothing left to process from).
 *
 * Runs sparsely; the dispatch worker + lease already handle the common case. This is the
 * last-line guarantee that every reserved slot converges to a usable image or a real failure.
 */
@Injectable()
export class RembgReconciler {
  private readonly logger = new Logger(RembgReconciler.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly completion: RembgCompletionService,
    private readonly s3Service: S3Service,
  ) {}

  /** Reserved image slots that are stuck — still 'processing' or terminally 'failed'. */
  private async findStuckSlots(): Promise<StuckSlot[]> {
    const docs = await this.productModel
      .find({ 'images.status': { $in: ['processing', 'failed'] } })
      .select('_id images')
      .lean()
      .exec();

    const out: StuckSlot[] = [];
    for (const doc of docs as any[]) {
      for (const img of doc.images ?? []) {
        if ((img?.status === 'processing' || img?.status === 'failed') && img?.slotId) {
          out.push({ productId: String(doc._id), slotId: img.slotId, status: img.status, url: img.url, key: img.key });
        }
      }
    }
    return out;
  }

  /** Recreate a pending job for a stuck slot and put the slot back to 'processing'. */
  private async requeue(slot: StuckSlot, job: any): Promise<void> {
    await this.rembgJobModel.create({
      productId: slot.productId,
      slotId: slot.slotId,
      rawS3Key: slot.key,
      batchCode: job?.batchCode || `RB-RECON-${Date.now()}`,
      batchNote: job?.batchNote ?? null,
      options: job?.options ?? null,
      status: 'pending',
      attempts: 0,
    });
    if (slot.status === 'failed') {
      await this.productModel.updateOne(
        { _id: slot.productId, 'images.slotId': slot.slotId },
        { $set: { 'images.$.status': 'processing' } },
      );
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile(): Promise<void> {
    const slots = await this.findStuckSlots();
    if (slots.length === 0) return;

    let recreated = 0;
    let resolved = 0;
    let failed = 0;

    for (const slot of slots) {
      const job = await this.rembgJobModel
        .findOne({ productId: slot.productId, slotId: slot.slotId })
        .sort({ createdAt: -1 })
        .lean();

      // A live job already owns this slot — leave it to the dispatcher.
      if (job && (job.status === 'pending' || job.status === 'dispatched')) continue;

      // The job already reached success but the slot missed the fill — re-apply (idempotent).
      if (job && job.status === 'done' && job.processedImageKey) {
        await this.completion.applySuccess(String(job._id), {
          url: slot.url!,
          key: job.processedImageKey,
          source: job.source,
        }).catch(() => {});
        resolved++;
        continue;
      }

      // A permanently-failed job means the source image is unusable — never re-queue it
      // (reprocessing can't succeed and would loop/waste credits). Leave the slot failed.
      if (job && job.status === 'failed' && (job as any).permanentFailure) continue;

      // No live job. Retry only if the raw still exists (credit not spent, image still there).
      if (slot.key && (await this.s3Service.fileExists(slot.key))) {
        await this.requeue(slot, job);
        recreated++;
        continue;
      }

      // Nothing to process from → fail the slot (idempotent if already failed).
      if (slot.status !== 'failed') {
        await this.completion.markSlotFailed(slot.productId, slot.slotId).catch(() => {});
        failed++;
      }
    }

    if (recreated || resolved || failed) {
      this.logger.warn(
        `[RembgReconcile] slots=${slots.length} recreated=${recreated} resolved=${resolved} failed=${failed}`,
      );
    }
  }
}
