import { Injectable } from '@nestjs/common';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import { VehicleAiOutput, VehicleMarket, VehicleReviewStatus, VehicleSourceType } from '../types/vehicle.types';
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
} from '../utils/vehicle-normalizer.util';

@Injectable()
export class VehicleCanonicalMapper {
  fromAiOutput(ai: VehicleAiOutput, market: VehicleMarket) {
    const make = ai.make ?? '';
    const model = ai.model ?? '';
    const version = ai.version ?? '';

    const aliases = [...new Set([
      ...(ai.aliases ?? []),
      ...deriveAliases(make, model, version, ai.productionYears ?? []),
    ])].slice(0, 20);

    const tags = [...new Set((ai.tags ?? []).map((t) => t.toLowerCase().trim()))];

    const engine = {
      displacement: ai.engine?.displacement,
      family: ai.engine?.family,
      aspiration: ai.engine?.aspiration,
      fuelType: ai.engine?.fuelType ?? ai.fuelType,
      valvetrain: ai.engine?.valvetrain,
      powerCvGasoline: ai.engine?.powerCvGasoline,
      powerCvEthanol: ai.engine?.powerCvEthanol,
      torqueNm: ai.engine?.torqueNm,
    };

    const canonicalKey = `${VEHICLE_CONSTANTS.CANONICAL_VERSION}:${generateCanonicalKey(
      make,
      model,
      version,
      generateEngineSignature(engine),
      market,
    )}`;

    const searchText = buildSearchText(make, model, version, aliases, tags);
    const dataQualityScore = computeDataQualityScore({
      make,
      model,
      version,
      productionYears: ai.productionYears,
      engine,
      transmission: ai.transmission,
      bodyType: ai.bodyType,
      platform: ai.platform,
      fipe: ai.fipe,
      aliases,
    });

    return {
      make,
      model,
      version,
      versionDisplay: ai.versionStandard ?? normalizeVersionDisplay(version),
      market,
      engine,
      transmission: ai.transmission ?? [],
      productionYears: ai.productionYears ?? [],
      years: ai.productionYears ?? [],
      platform: ai.platform,
      generation: ai.generation,
      facelift: ai.facelift,
      bodyType: ai.bodyType,
      fipe: ai.fipe,
      aliases,
      tags,
      searchText,
      normalized: {
        make: normalizeMake(make),
        model: normalizeModel(model),
        version: normalizeVersionDisplay(version),
        versionDisplay: normalizeVersionDisplay(version),
        engineTokens: normalizeEngineTokens([engine.family, engine.displacement].filter(Boolean).join(' ')),
      },
      canonicalKey,
      canonicalVersion: VEHICLE_CONSTANTS.CANONICAL_VERSION,
      normalizerVersion: VEHICLE_CONSTANTS.NORMALIZER_VERSION,
      dataQualityScore,
      sourceType: VehicleSourceType.AI_INFERENCE,
      reviewStatus: VehicleReviewStatus.PENDING_REVIEW,
      confidence: normalizeConfidence(ai.confidence),
    };
  }
}
