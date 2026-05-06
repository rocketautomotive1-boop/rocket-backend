import { Injectable } from '@nestjs/common';
import {
  CRITICAL_WARNING_TAGS,
  VEHICLE_APPROVAL_THRESHOLDS,
  VehicleApprovalTier,
} from '../constants/vehicle.constants';
import { VehicleAiOutput } from '../types/vehicle.types';
import { computeDataQualityScore, normalizeConfidence } from '../utils/vehicle-normalizer.util';

export interface ApprovalResult {
  promote: boolean;
  tier: VehicleApprovalTier;
  reason: string;
  blockers: string[];
  dataQualityScore: number;
}

@Injectable()
export class VehicleApprovalPolicy {
  evaluate(ai: VehicleAiOutput): ApprovalResult {
    const confidence = normalizeConfidence(ai.confidence) ?? 0;
    const dataQualityScore = computeDataQualityScore({
      make: ai.make,
      model: ai.model,
      version: ai.version,
      productionYears: ai.productionYears,
      engine: ai.engine,
      transmission: ai.transmission,
      bodyType: ai.bodyType,
      platform: ai.platform,
      fipe: ai.fipe,
      aliases: ai.aliases,
    });

    const hasCriticalWarnings = (ai.warnings ?? []).some((w) =>
      CRITICAL_WARNING_TAGS.includes(w as any),
    );

    const hasCoreFields = Boolean(ai.make && ai.model && ai.version && ai.productionYears?.length);
    const hasEngineKey = Boolean(ai.engine?.fuelType && ai.engine?.displacement);

    if (
      hasCoreFields &&
      !hasCriticalWarnings &&
      confidence >= VEHICLE_APPROVAL_THRESHOLDS.TIER_1_MIN_CONFIDENCE &&
      dataQualityScore >= VEHICLE_APPROVAL_THRESHOLDS.TIER_1_MIN_QUALITY &&
      hasEngineKey
    ) {
      return {
        promote: true,
        tier: VehicleApprovalTier.TIER_1_FITMENT_READY,
        reason: `tier_1: confidence=${confidence}, quality=${dataQualityScore}`,
        blockers: [],
        dataQualityScore,
      };
    }

    if (
      hasCoreFields &&
      !hasCriticalWarnings &&
      confidence >= VEHICLE_APPROVAL_THRESHOLDS.TIER_2_MIN_CONFIDENCE &&
      dataQualityScore >= VEHICLE_APPROVAL_THRESHOLDS.TIER_2_MIN_QUALITY
    ) {
      return {
        promote: true,
        tier: VehicleApprovalTier.TIER_2_SEARCH_READY,
        reason: `tier_2: confidence=${confidence}, quality=${dataQualityScore}`,
        blockers: [],
        dataQualityScore,
      };
    }

    const blockers: string[] = [];
    if (!hasCoreFields) blockers.push('missing_core_fields');
    if (hasCriticalWarnings) blockers.push('has_critical_warnings');
    if (confidence < VEHICLE_APPROVAL_THRESHOLDS.TIER_2_MIN_CONFIDENCE) blockers.push('low_confidence');
    if (dataQualityScore < VEHICLE_APPROVAL_THRESHOLDS.TIER_2_MIN_QUALITY) blockers.push('low_quality');

    return {
      promote: false,
      tier: VehicleApprovalTier.TIER_3_DISCOVERY_ONLY,
      reason: `tier_3: ${blockers.join(', ')}`,
      blockers,
      dataQualityScore,
    };
  }
}
