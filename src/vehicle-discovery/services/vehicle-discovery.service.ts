import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VehicleDiscoveryDocument, VehicleDiscoveryModel } from '../schemas/vehicle-discovery.schema';
import { CreateVehicleDiscoveryDto } from '../dto/create-vehicle-discovery.dto';
import { SearchVehicleDiscoveriesDto } from '../dto/search-vehicle-discoveries.dto';
import { ApproveVehicleDiscoveryDto } from '../dto/approve-vehicle-discovery.dto';
import { RejectVehicleDiscoveryDto } from '../dto/reject-vehicle-discovery.dto';
import {
  VehicleDiscoveryDuplicateException,
  VehicleDiscoveryInvalidStatusException,
  VehicleDiscoveryNotFoundException,
} from '../../vehicle-shared/exceptions/vehicle.exceptions';
import {
  VehicleDiscoverySource,
  VehicleDiscoveryStatus,
  VehicleReviewStatus,
} from '../../vehicle-shared/types/vehicle.types';
import {
  VEHICLE_CONSTANTS,
  VEHICLE_DISCOVERY_PRIORITY,
} from '../../vehicle-shared/constants/vehicle.constants';
import {
  generateLockKey,
  normalizeConfidence,
} from '../../vehicle-shared/utils/vehicle-normalizer.util';
import { VehicleMetricsService } from '../../vehicle-shared/metrics/vehicle-metrics.service';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import {
  VehicleMarket,
  VehicleSourceType,
} from '../../vehicle-shared/types/vehicle.types';

@Injectable()
export class VehicleDiscoveryService {
  private readonly logger = new Logger(VehicleDiscoveryService.name);

  constructor(
    @InjectModel(VehicleDiscoveryModel.name)
    private readonly discoveryModel: Model<VehicleDiscoveryDocument>,
    private readonly metrics: VehicleMetricsService,
    private readonly compatibilityService: VehicleCompatibilityService,
  ) {}

  async create(dto: CreateVehicleDiscoveryDto): Promise<VehicleDiscoveryDocument> {
    const lockKey = this.buildLockKey(dto);
    await this.cleanStalePending(lockKey);

    const existing = await this.discoveryModel
      .findOne({ lockKey, status: { $in: [VehicleDiscoveryStatus.PENDING, VehicleDiscoveryStatus.PROCESSING] } })
      .lean()
      .exec();

    if (existing) {
      this.metrics.recordDuplicateAvoided();
      throw new VehicleDiscoveryDuplicateException(lockKey);
    }

    try {
      const now = new Date();
      const doc = new this.discoveryModel({
        input: dto.input,
        source: dto.source ?? VehicleDiscoverySource.AI,
        status: VehicleDiscoveryStatus.PENDING,
        lockKey,
        priority: dto.priority ?? VEHICLE_DISCOVERY_PRIORITY.NORMAL,
        logs: [`[${now.toISOString()}] created`],
        statusHistory: [{ status: VehicleDiscoveryStatus.PENDING, at: now }],
        retryCount: 0,
        needsReprocessing: false,
        reviewStatus: VehicleReviewStatus.PENDING_REVIEW,
        aiPromptVersion: VEHICLE_CONSTANTS.AI_PROMPT_VERSION,
      });
      return await doc.save();
    } catch (err) {
      if (err?.code === 11000) {
        this.metrics.recordDuplicateAvoided();
        throw new VehicleDiscoveryDuplicateException(lockKey);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<VehicleDiscoveryDocument> {
    const doc = await this.discoveryModel.findById(id).exec();
    if (!doc) throw new VehicleDiscoveryNotFoundException(id);
    return doc;
  }

  async search(dto: SearchVehicleDiscoveriesDto): Promise<{ data: VehicleDiscoveryDocument[]; total: number }> {
    const filter: Record<string, any> = {};

    if (dto.status?.length) filter.status = { $in: dto.status };
    if (dto.reviewStatus) filter.reviewStatus = dto.reviewStatus;
    if (dto.make) filter['input.make'] = new RegExp(dto.make, 'i');
    if (dto.model) filter['input.model'] = new RegExp(dto.model, 'i');
    if (dto.version) filter['input.version'] = new RegExp(dto.version, 'i');
    if (dto.source) filter.source = dto.source;

    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const [data, total] = await Promise.all([
      this.discoveryModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(dto.limit ?? 20).lean().exec(),
      this.discoveryModel.countDocuments(filter).exec(),
    ]);

    return { data: data as any, total };
  }

  async claimForProcessing(batchSize = VEHICLE_CONSTANTS.WORKER_BATCH_SIZE): Promise<VehicleDiscoveryDocument[]> {
    const now = new Date();
    const reprocessSlots = Math.max(1, Math.floor(batchSize / 3));
    const pendingSlots = Math.max(1, batchSize - reprocessSlots);

    const [pending, reprocess] = await Promise.all([
      this.discoveryModel
        .find({
          status: VehicleDiscoveryStatus.PENDING,
          retryCount: { $lt: VEHICLE_CONSTANTS.MAX_RETRY_COUNT },
        })
        .sort({ priority: -1, createdAt: 1 })
        .limit(pendingSlots)
        .lean()
        .exec(),
      this.discoveryModel
        .find({
          status: VehicleDiscoveryStatus.PROCESSED,
          needsReprocessing: true,
          aiPromptVersion: { $ne: VEHICLE_CONSTANTS.AI_PROMPT_VERSION },
        })
        .sort({ createdAt: 1 })
        .limit(reprocessSlots)
        .lean()
        .exec(),
    ]);

    const claimed: VehicleDiscoveryDocument[] = [];

    for (const item of pending) {
      const doc = await this.discoveryModel
        .findOneAndUpdate(
          { _id: item._id, status: VehicleDiscoveryStatus.PENDING },
          {
            $set: { status: VehicleDiscoveryStatus.PROCESSING },
            $push: {
              logs: `[${now.toISOString()}] claimed for processing`,
              statusHistory: { status: VehicleDiscoveryStatus.PROCESSING, at: now },
            },
          },
          { new: true },
        )
        .exec();
      if (doc) claimed.push(doc);
    }

    for (const item of reprocess) {
      const doc = await this.discoveryModel
        .findOneAndUpdate(
          {
            _id: item._id,
            status: VehicleDiscoveryStatus.PROCESSED,
            needsReprocessing: true,
          },
          {
            $set: {
              status: VehicleDiscoveryStatus.PROCESSING,
              needsReprocessing: false,
            },
            $push: {
              logs: `[${now.toISOString()}] claimed for reprocessing`,
              statusHistory: { status: VehicleDiscoveryStatus.PROCESSING, at: now, reason: 'reprocess' },
            },
          },
          { new: true },
        )
        .exec();
      if (doc) claimed.push(doc);
    }

    return claimed;
  }

  async markProcessed(
    id: string,
    data: {
      ai: Record<string, any>;
      canonical: Record<string, any>;
      aiRawResponse: Record<string, any>;
      aiModel: string;
      aiPromptVersion: string;
    },
  ): Promise<VehicleDiscoveryDocument> {
    const now = new Date();
    const doc = await this.discoveryModel
      .findOneAndUpdate(
        { _id: id, status: VehicleDiscoveryStatus.PROCESSING },
        {
          $set: {
            status: VehicleDiscoveryStatus.PROCESSED,
            ai: data.ai,
            canonical: data.canonical,
            aiRawResponse: data.aiRawResponse,
            aiModel: data.aiModel,
            aiPromptVersion: data.aiPromptVersion,
            processedAt: now,
            reviewStatus: VehicleReviewStatus.PENDING_REVIEW,
          },
          $push: {
            logs: `[${now.toISOString()}] processed by AI`,
            statusHistory: { status: VehicleDiscoveryStatus.PROCESSED, at: now },
          },
        },
        { new: true },
      )
      .exec();
    if (!doc) throw new VehicleDiscoveryNotFoundException(id);
    return doc;
  }

  async approve(id: string, dto: ApproveVehicleDiscoveryDto, compatibilityId?: string): Promise<VehicleDiscoveryDocument> {
    const doc = await this.findById(id);
    const allowed = [VehicleDiscoveryStatus.PROCESSED, VehicleDiscoveryStatus.PENDING, VehicleDiscoveryStatus.APPROVED];
    if (!allowed.includes(doc.status as any)) {
      throw new VehicleDiscoveryInvalidStatusException(doc.status, allowed);
    }

    let resolvedCompatibilityId = compatibilityId;

    // Manual approval must also promote canonical data to the vehicle_compatibilities collection.
    // This also repairs old records that are already APPROVED but were never promoted.
    if (!resolvedCompatibilityId && !doc.compatibilityId) {
      resolvedCompatibilityId = await this.promoteCanonicalFromDiscovery(doc);
    }

    // Idempotent path: already approved. Keep as success and only backfill compatibility link if needed.
    if (doc.status === VehicleDiscoveryStatus.APPROVED) {
      if (!resolvedCompatibilityId) {
        return doc;
      }
      const updated = await this.discoveryModel
        .findByIdAndUpdate(
          id,
          {
            $set: {
              compatibilityId: resolvedCompatibilityId as any,
              reviewedBy: dto.reviewedBy ?? doc.reviewedBy,
              reviewReason: dto.reviewReason ?? doc.reviewReason,
              reviewedAt: new Date(),
            },
            $push: {
              logs: `[${new Date().toISOString()}] approved idempotent backfill compatibilityId=${resolvedCompatibilityId}`,
            },
          },
          { new: true },
        )
        .exec();
      return updated ?? doc;
    }

    const now = new Date();
    const update: any = {
      $set: {
        status: VehicleDiscoveryStatus.APPROVED,
        reviewStatus: VehicleReviewStatus.MANUALLY_APPROVED,
        approvedAt: now,
        reviewedBy: dto.reviewedBy,
        reviewReason: dto.reviewReason,
        reviewedAt: now,
      },
      $push: {
        logs: `[${now.toISOString()}] approved by ${dto.reviewedBy ?? 'system'}`,
        statusHistory: {
          status: VehicleDiscoveryStatus.APPROVED,
          at: now,
          by: dto.reviewedBy,
          reason: dto.reviewReason,
        },
      },
    };
    if (resolvedCompatibilityId) update.$set.compatibilityId = resolvedCompatibilityId;

    return this.discoveryModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async autoApprove(
    id: string,
    reason: string,
    compatibilityId?: string,
  ): Promise<VehicleDiscoveryDocument> {
    const now = new Date();
    const update: any = {
      $set: {
        status: VehicleDiscoveryStatus.APPROVED,
        reviewStatus: VehicleReviewStatus.AUTO_APPROVED,
        approvedAt: now,
        reviewReason: reason,
        reviewedAt: now,
      },
      $push: {
        logs: `[${now.toISOString()}] auto-approved: ${reason}`,
        statusHistory: {
          status: VehicleDiscoveryStatus.APPROVED,
          at: now,
          by: 'system',
          reason,
        },
      },
    };
    if (compatibilityId) update.$set.compatibilityId = compatibilityId;

    const doc = await this.discoveryModel
      .findOneAndUpdate(
        { _id: id, status: VehicleDiscoveryStatus.PROCESSED },
        update,
        { new: true },
      )
      .exec();

    if (!doc) throw new VehicleDiscoveryNotFoundException(id);
    return doc;
  }

  async reject(id: string, dto: RejectVehicleDiscoveryDto): Promise<VehicleDiscoveryDocument> {
    const now = new Date();
    const doc = await this.discoveryModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: VehicleDiscoveryStatus.REJECTED,
            reviewStatus: VehicleReviewStatus.REJECTED,
            rejectedAt: now,
            reviewedBy: dto.reviewedBy,
            reviewReason: dto.reviewReason,
            reviewedAt: now,
          },
          $push: {
            logs: `[${now.toISOString()}] rejected by ${dto.reviewedBy ?? 'system'}`,
            statusHistory: {
              status: VehicleDiscoveryStatus.REJECTED,
              at: now,
              by: dto.reviewedBy,
              reason: dto.reviewReason,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!doc) throw new VehicleDiscoveryNotFoundException(id);
    return doc;
  }

  async markError(id: string, errorMessage: string): Promise<VehicleDiscoveryDocument> {
    const now = new Date();
    const doc = await this.discoveryModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: VehicleDiscoveryStatus.ERROR,
            errorMessage,
          },
          $inc: { retryCount: 1 },
          $push: {
            logs: `[${now.toISOString()}] error: ${errorMessage}`,
            statusHistory: {
              status: VehicleDiscoveryStatus.ERROR,
              at: now,
              reason: errorMessage,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!doc) throw new VehicleDiscoveryNotFoundException(id);
    return doc;
  }

  async requeueAfterError(id: string): Promise<VehicleDiscoveryDocument> {
    const doc = await this.findById(id);
    if (doc.retryCount >= VEHICLE_CONSTANTS.MAX_RETRY_COUNT) {
      this.logger.warn(`Discovery ${id} reached max retries, not re-queuing`);
      return doc;
    }

    const now = new Date();
    return this.discoveryModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: VehicleDiscoveryStatus.PENDING,
            errorMessage: null,
          },
          $push: {
            logs: `[${now.toISOString()}] re-queued after error (attempt ${doc.retryCount + 1})`,
            statusHistory: { status: VehicleDiscoveryStatus.PENDING, at: now, reason: 'manual_requeue' },
          },
        },
        { new: true },
      )
      .exec();
  }

  async recoverStale(): Promise<void> {
    const threshold = new Date(Date.now() - VEHICLE_CONSTANTS.STALE_PROCESSING_THRESHOLD_MS);

    const result = await this.discoveryModel
      .updateMany(
        {
          status: VehicleDiscoveryStatus.PROCESSING,
          updatedAt: { $lt: threshold },
          retryCount: { $lt: VEHICLE_CONSTANTS.MAX_RETRY_COUNT },
        },
        {
          $set: { status: VehicleDiscoveryStatus.PENDING },
          $push: {
            logs: `[${new Date().toISOString()}] recovered from stale processing`,
            statusHistory: { status: VehicleDiscoveryStatus.PENDING, at: new Date(), reason: 'stale_recovery' },
          },
        },
      )
      .exec();

    if (result.modifiedCount > 0) {
      this.logger.warn(`Recovered ${result.modifiedCount} stale discovery items`);
    }
  }

  private buildLockKey(dto: CreateVehicleDiscoveryDto): string {
    return generateLockKey(
      dto.input.make ?? '',
      dto.input.model ?? '',
      dto.input.version ?? '',
      dto.input.sourceItemId,
      dto.input.source,
      dto.input.title,
      dto.input.engine,
    );
  }

  private async cleanStalePending(lockKey: string): Promise<void> {
    const threshold = new Date(Date.now() - VEHICLE_CONSTANTS.STALE_PROCESSING_THRESHOLD_MS);
    await this.discoveryModel
      .updateMany(
        {
          lockKey,
          status: VehicleDiscoveryStatus.PENDING,
          updatedAt: { $lt: threshold },
        },
        {
          $set: {
            status: VehicleDiscoveryStatus.ERROR,
            errorMessage: 'stale_pending_cleanup',
          },
        },
      )
      .exec();
  }

  private async promoteCanonicalFromDiscovery(doc: VehicleDiscoveryDocument): Promise<string | undefined> {
    const canonical = (doc as any)?.canonical ?? {};
    if (!canonical?.make || !canonical?.model || !canonical?.version) {
      this.logger.warn(`Discovery ${String(doc._id)} has no canonical minimum fields for promotion`);
      return undefined;
    }

    const years: number[] =
      (Array.isArray(canonical.years) && canonical.years.length
        ? canonical.years
        : Array.isArray(canonical.productionYears)
          ? canonical.productionYears
          : []) ?? [];

    const upsertDto: any = {
      make: canonical.make,
      model: canonical.model,
      version: canonical.version,
      versionDisplay: canonical.versionDisplay,
      market: canonical.market ?? VehicleMarket.BR,
      engine: canonical.engine,
      transmission: canonical.transmission,
      productionYears: years.length
        ? { from: Math.min(...years), to: Math.max(...years) }
        : undefined,
      years,
      platform: canonical.platform,
      generation: canonical.generation,
      facelift: canonical.facelift,
      bodyType: canonical.bodyType,
      fipe: canonical.fipe,
      aliases: canonical.aliases ?? [],
      tags: canonical.tags ?? [],
      sourceType: VehicleSourceType.MANUAL_REVIEW,
      reviewStatus: VehicleReviewStatus.MANUALLY_APPROVED,
      confidence: normalizeConfidence(canonical.confidence),
      approvalTier: canonical.approvalTier,
      canonicalVersion: canonical.canonicalVersion,
      normalizerVersion: canonical.normalizerVersion,
    };

    const compatibility = await this.compatibilityService.upsertByCanonicalKey(
      upsertDto,
      String(doc._id),
    );

    return String((compatibility as any)?._id ?? '');
  }
}
