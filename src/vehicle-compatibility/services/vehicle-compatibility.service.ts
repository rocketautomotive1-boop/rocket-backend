import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VehicleCompatibilityDocument, VehicleCompatibilityModel } from '../schemas/vehicle-compatibility.schema';
import { CreateVehicleCompatibilityDto } from '../dto/create-vehicle-compatibility.dto';
import { UpdateVehicleCompatibilityDto } from '../dto/update-vehicle-compatibility.dto';
import { SearchVehicleCompatibilitiesDto } from '../dto/search-vehicle-compatibilities.dto';
import { UpsertVehicleCompatibilityDto } from '../dto/upsert-vehicle-compatibility.dto';
import { VehicleCompatibilityNotFoundException } from '../../vehicle-shared/exceptions/vehicle.exceptions';
import {
  buildSearchText,
  computeDataQualityScore,
  deriveAliases,
  generateCanonicalKey,
  generateEngineSignature,
  normalizeEngineTokens,
  normalizeMake,
  normalizeModel,
  normalizeVersionDisplay,
  normalizeConfidence,
} from '../../vehicle-shared/utils/vehicle-normalizer.util';
import { VehicleMarket, VehicleReviewStatus } from '../../vehicle-shared/types/vehicle.types';
import { VEHICLE_CONSTANTS } from '../../vehicle-shared/constants/vehicle.constants';
import { VehicleMetricsService } from '../../vehicle-shared/metrics/vehicle-metrics.service';

@Injectable()
export class VehicleCompatibilityService {
  private readonly logger = new Logger(VehicleCompatibilityService.name);

  constructor(
    @InjectModel(VehicleCompatibilityModel.name)
    private readonly model: Model<VehicleCompatibilityDocument>,
    private readonly metrics: VehicleMetricsService,
  ) {}

  async create(dto: CreateVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const enriched = this.buildEnrichedFields(dto);
    const doc = new this.model(enriched);
    return doc.save();
  }

  async upsertByCanonicalKey(
    dto: UpsertVehicleCompatibilityDto,
    sourceDiscoveryId?: string,
  ): Promise<VehicleCompatibilityDocument> {
    const incoming = this.buildEnrichedFields(dto as any);
    if (sourceDiscoveryId && Types.ObjectId.isValid(sourceDiscoveryId)) {
      (incoming as any).sourceDiscoveryId = new Types.ObjectId(sourceDiscoveryId);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const inserted = await this.model
        .findOneAndUpdate(
          { canonicalKey: incoming.canonicalKey },
          { $setOnInsert: incoming },
          { upsert: true, new: true },
        )
        .exec();

      if (!inserted) continue;

      const existing = await this.model
        .findOne({ canonicalKey: incoming.canonicalKey })
        .lean()
        .exec();

      if (!existing) continue;

      const isIncomingBetter = incoming.dataQualityScore > (existing.dataQualityScore ?? 0);
      const mergedAliases = [...new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])])].slice(0, 20);
      const mergedTags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];

      const update: Record<string, any> = {
        searchText: incoming.searchText,
        dataQualityScore: Math.max(existing.dataQualityScore ?? 0, incoming.dataQualityScore),
        aliases: mergedAliases,
        tags: mergedTags,
        canonicalVersion: incoming.canonicalVersion,
        normalizerVersion: incoming.normalizerVersion,
      };

      if ((incoming as any).sourceDiscoveryId) {
        update.sourceDiscoveryId = (incoming as any).sourceDiscoveryId;
      }

      if (isIncomingBetter) {
        const fieldsToPromote = [
          'engine', 'transmission', 'productionYears', 'years', 'fuel', 'platform',
          'generation', 'facelift', 'bodyType', 'segment', 'fipe', 'chassis',
          'normalized', 'versionDisplay', 'confidence', 'reviewStatus', 'approvalTier',
        ];
        for (const field of fieldsToPromote) {
          if ((incoming as any)[field] !== undefined && (incoming as any)[field] !== null) {
            update[field] = (incoming as any)[field];
          }
        }
      }

      const result = await this.model
        .findOneAndUpdate(
          { canonicalKey: incoming.canonicalKey },
          { $set: update },
          { new: true },
        )
        .exec();

      this.logger.debug(`Upserted compatibility ${incoming.canonicalKey}`);
      return result as any;
    }

    throw new Error(`Failed to upsert canonicalKey=${incoming.canonicalKey}`);
  }

  async findById(id: string): Promise<VehicleCompatibilityDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new VehicleCompatibilityNotFoundException(id);
    return doc;
  }

  async update(id: string, dto: UpdateVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const doc = await this.model.findByIdAndUpdate(id, { $set: dto }, { new: true }).exec();
    if (!doc) throw new VehicleCompatibilityNotFoundException(id);
    return doc;
  }

  async deactivate(id: string): Promise<void> {
    const result = await this.model.updateOne({ _id: id }, { $set: { active: false } }).exec();
    if (result.matchedCount === 0) throw new VehicleCompatibilityNotFoundException(id);
  }

  async search(
    dto: SearchVehicleCompatibilitiesDto,
  ): Promise<{ data: VehicleCompatibilityDocument[]; total: number }> {
    const filter: Record<string, any> = {};

    if (dto.active !== undefined) filter.active = dto.active;
    if (dto.market) filter.market = dto.market;
    if (dto.bodyType) filter.bodyType = dto.bodyType;
    if (dto.year) filter.years = dto.year;
    if (dto.engineCode) filter['engine.code'] = dto.engineCode;
    if (dto.engineFamily) filter['engine.family'] = dto.engineFamily;
    if (dto.transmission) filter.transmission = dto.transmission;

    if (dto.make) filter['normalized.make'] = normalizeMake(dto.make);
    if (dto.model) filter['normalized.model'] = normalizeModel(dto.model);
    if (dto.version) filter['normalized.version'] = normalizeVersionDisplay(dto.version);

    if (dto.q) return this.atlasSearch(dto);

    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ dataQualityScore: -1, make: 1, model: 1, version: 1 })
        .skip(skip)
        .limit(dto.limit ?? 20)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data: data as any, total };
  }

  async atlasSearch(
    dto: SearchVehicleCompatibilitiesDto,
  ): Promise<{ data: VehicleCompatibilityDocument[]; total: number }> {
    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const limit = dto.limit ?? 20;

    const searchStage: any = {
      $search: {
        index: 'vehicle_compatibility_search',
        compound: {
          should: [
            { text: { query: dto.q, path: 'normalized.make', score: { boost: { value: 5 } } } },
            { text: { query: dto.q, path: 'normalized.model', score: { boost: { value: 5 } } } },
            { text: { query: dto.q, path: 'normalized.version', score: { boost: { value: 3 } } } },
            { text: { query: dto.q, path: 'aliases', score: { boost: { value: 2 } } } },
            { text: { query: dto.q, path: 'tags', score: { boost: { value: 1 } } } },
            { text: { query: dto.q, path: 'searchText', fuzzy: { maxEdits: 1 }, score: { boost: { value: 1 } } } },
          ],
          minimumShouldMatch: 1,
          filter: [],
        },
      },
    };

    if (dto.active !== undefined) {
      searchStage.$search.compound.filter.push({ equals: { path: 'active', value: dto.active } });
    }
    if (dto.year) {
      searchStage.$search.compound.filter.push({ equals: { path: 'years', value: dto.year } });
    }
    if (dto.market) {
      searchStage.$search.compound.filter.push({ text: { path: 'market', query: dto.market } });
    }

    try {
      const result = await this.model.aggregate([
        searchStage,
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            meta: [{ $count: 'total' }],
          },
        },
      ]).exec();

      const data = result?.[0]?.data ?? [];
      const total = result?.[0]?.meta?.[0]?.total ?? 0;
      return { data, total };
    } catch (err) {
      this.logger.warn(`Atlas Search unavailable, falling back to text search: ${err?.message}`);
      const filter: any = { $text: { $search: dto.q } };
      if (dto.active !== undefined) filter.active = dto.active;
      if (dto.market) filter.market = dto.market;
      if (dto.year) filter.years = dto.year;

      const [data, total] = await Promise.all([
        this.model
          .find(filter)
          .sort({ score: { $meta: 'textScore' } })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.model.countDocuments(filter).exec(),
      ]);
      return { data: data as any, total };
    }
  }

  private buildEnrichedFields(
    dto: CreateVehicleCompatibilityDto & {
      reviewStatus?: VehicleReviewStatus;
      approvalTier?: string;
      canonicalVersion?: string;
      normalizerVersion?: string;
    },
  ): Partial<VehicleCompatibilityModel> & { canonicalKey: string } {
    const market = dto.market ?? VehicleMarket.BR;
    const allAliases = [
      ...(dto.aliases ?? []),
      ...deriveAliases(dto.make, dto.model, dto.version, dto.years ?? []),
    ]
      .map((v) => v.toLowerCase().trim())
      .filter((v) => v.length > 2);

    const tags = [...new Set((dto.tags ?? []).map((v) => v.toLowerCase().trim()))];

    const engineTokens = normalizeEngineTokens([
      (dto.engine as any)?.family,
      (dto.engine as any)?.displacement,
    ].filter(Boolean).join(' '));

    const canonicalKey = `${VEHICLE_CONSTANTS.CANONICAL_VERSION}:${generateCanonicalKey(
      dto.make,
      dto.model,
      dto.version,
      generateEngineSignature(dto.engine as any),
      market,
    )}`;

    const dataQualityScore = computeDataQualityScore({
      make: dto.make,
      model: dto.model,
      version: dto.version,
      productionYears: dto.years,
      engine: dto.engine as any,
      transmission: dto.transmission,
      bodyType: dto.bodyType,
      platform: dto.platform,
      fipe: dto.fipe as any,
      aliases: allAliases,
    });

    return {
      make: dto.make,
      model: dto.model,
      version: dto.version,
      versionDisplay: dto.versionDisplay ?? normalizeVersionDisplay(dto.version),
      market,
      engine: dto.engine as any,
      transmission: dto.transmission,
      productionYears: dto.productionYears as any,
      years: dto.years,
      fuel: dto.fuel as any,
      platform: dto.platform,
      generation: dto.generation,
      facelift: dto.facelift,
      bodyType: dto.bodyType,
      segment: dto.segment,
      fipe: dto.fipe as any,
      chassis: dto.chassis as any,
      aliases: [...new Set(allAliases)].slice(0, 20),
      tags,
      searchText: buildSearchText(dto.make, dto.model, dto.version, allAliases, tags),
      normalized: {
        make: normalizeMake(dto.make),
        model: normalizeModel(dto.model),
        version: normalizeVersionDisplay(dto.version),
        versionDisplay: normalizeVersionDisplay(dto.version),
        engineTokens,
      },
      canonicalKey,
      canonicalVersion: dto.canonicalVersion ?? VEHICLE_CONSTANTS.CANONICAL_VERSION,
      normalizerVersion: dto.normalizerVersion ?? VEHICLE_CONSTANTS.NORMALIZER_VERSION,
      dataQualityScore,
      active: dto.active ?? true,
      sourceType: dto.sourceType,
      reviewStatus: dto.reviewStatus ?? VehicleReviewStatus.AUTO_APPROVED,
      confidence: normalizeConfidence(dto.confidence),
      approvalTier: dto.approvalTier,
    };
  }
}
