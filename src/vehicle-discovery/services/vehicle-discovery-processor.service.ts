import { Injectable, Logger } from '@nestjs/common';
import { VehicleDiscoveryService } from './vehicle-discovery.service';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { VehicleAiService } from '../../vehicle-shared/ai/vehicle-ai.service';
import { VehicleCanonicalMapper } from '../../vehicle-shared/mappers/vehicle-canonical.mapper';
import { VehicleApprovalPolicy } from '../../vehicle-shared/policies/vehicle-approval.policy';
import { VehicleDiscoveryDocument } from '../schemas/vehicle-discovery.schema';
import { VehicleMarket, VehicleSourceType } from '../../vehicle-shared/types/vehicle.types';
import { VEHICLE_CONSTANTS } from '../../vehicle-shared/constants/vehicle.constants';
import { VehicleAiCacheService } from '../../vehicle-shared/ai/vehicle-ai-cache.service';
import { generateAiCacheKey } from '../../vehicle-shared/utils/vehicle-normalizer.util';
import { VehicleMetricsService } from '../../vehicle-shared/metrics/vehicle-metrics.service';

@Injectable()
export class VehicleDiscoveryProcessorService {
  private readonly logger = new Logger(VehicleDiscoveryProcessorService.name);

  constructor(
    private readonly discoveryService: VehicleDiscoveryService,
    private readonly compatibilityService: VehicleCompatibilityService,
    private readonly aiService: VehicleAiService,
    private readonly canonicalMapper: VehicleCanonicalMapper,
    private readonly approvalPolicy: VehicleApprovalPolicy,
    private readonly aiCacheService: VehicleAiCacheService,
    private readonly metrics: VehicleMetricsService,
  ) {}

  async processOne(discovery: VehicleDiscoveryDocument): Promise<void> {
    const id = String(discovery._id);
    const start = Date.now();
    this.logger.log(`Processing discovery ${id}`);

    try {
      const cacheKey = generateAiCacheKey(discovery.input ?? {});
      let enrichResult = await this.aiCacheService.get(cacheKey);

      if (enrichResult) {
        this.metrics.recordCacheHit();
      } else {
        this.metrics.recordAiCall();
        const ai = await this.aiService.enrich(discovery.input as any);
        enrichResult = {
          output: ai.output,
          rawResponse: ai.rawResponse,
          model: ai.model,
        };
        await this.aiCacheService.set(cacheKey, ai.output, ai.rawResponse, ai.model);
      }

      const aiOutput = enrichResult.output;
      const canonical = this.canonicalMapper.fromAiOutput(aiOutput, VehicleMarket.BR);

      await this.discoveryService.markProcessed(id, {
        ai: aiOutput as any,
        canonical: canonical as any,
        aiRawResponse: { raw: enrichResult.rawResponse },
        aiModel: enrichResult.model,
        aiPromptVersion: VEHICLE_CONSTANTS.AI_PROMPT_VERSION,
      });

      const approval = this.approvalPolicy.evaluate(aiOutput);
      this.metrics.recordApproval(approval.promote ? approval.tier : 'manual');

      if (approval.promote) {
        const compatibility = await this.compatibilityService.upsertByCanonicalKey(
          {
            make: canonical.make,
            model: canonical.model,
            version: canonical.version,
            versionDisplay: canonical.versionDisplay,
            market: VehicleMarket.BR,
            engine: canonical.engine as any,
            transmission: canonical.transmission,
            productionYears: canonical.productionYears?.length
              ? { from: Math.min(...canonical.productionYears), to: Math.max(...canonical.productionYears) }
              : undefined,
            years: canonical.productionYears,
            platform: canonical.platform,
            generation: canonical.generation,
            facelift: canonical.facelift,
            bodyType: canonical.bodyType as any,
            fipe: canonical.fipe as any,
            aliases: canonical.aliases,
            tags: canonical.tags,
            sourceType: VehicleSourceType.AI_INFERENCE,
            confidence: canonical.confidence ?? undefined,
            reviewStatus: canonical.reviewStatus as any,
            approvalTier: approval.tier as any,
            canonicalVersion: canonical.canonicalVersion,
            normalizerVersion: canonical.normalizerVersion,
          } as any,
          id,
        );

        await this.discoveryService.autoApprove(
          id,
          `tier=${approval.tier}, confidence=${aiOutput.confidence}, canonicalKey=${canonical.canonicalKey}`,
          String(compatibility._id),
        );

        this.logger.log(`Auto-approved discovery ${id} using ${approval.tier}`);
      } else {
        this.logger.log(`Discovery ${id} pending manual review: ${approval.reason}`);
      }

      this.metrics.recordProcessed(Date.now() - start);
    } catch (err) {
      this.metrics.recordFailed(err?.constructor?.name ?? 'UnknownError');
      this.logger.error(`Error processing discovery ${id}: ${err?.message}`, err?.stack);
      await this.discoveryService.markError(id, err?.message ?? 'unknown_error');
    }
  }
}
