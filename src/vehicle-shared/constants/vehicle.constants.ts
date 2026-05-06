export const VEHICLE_CONSTANTS = {
  AUTO_APPROVAL_ENABLED: true,
  AUTO_APPROVAL_CONFIDENCE_THRESHOLD: 0.9,
  MIN_DATA_QUALITY_SCORE_FOR_AUTO_APPROVAL: 60,
  MAX_RETRY_COUNT: 3,
  WORKER_POLL_INTERVAL_MS: 5_000,
  WORKER_BATCH_SIZE: 6,
  WORKER_AI_CONCURRENCY: 2,
  STALE_PROCESSING_THRESHOLD_MS: 10 * 60_000,
  AI_PROMPT_VERSION: 'v1.0.0',
  CANONICAL_VERSION: 'v1',
  NORMALIZER_VERSION: 'v1',
  MIN_PRODUCTION_YEAR: 1900,
  MAX_PRODUCTION_YEAR: new Date().getFullYear() + 2,
  AI_CACHE_TTL_MS: 7 * 24 * 60 * 60_000,
} as const;

export const VEHICLE_DISCOVERY_PRIORITY = {
  HIGH: 10,
  NORMAL: 5,
  LOW: 1,
} as const;

export enum VehicleApprovalTier {
  TIER_1_FITMENT_READY = 'tier_1_fitment_ready',
  TIER_2_SEARCH_READY = 'tier_2_search_ready',
  TIER_3_DISCOVERY_ONLY = 'tier_3_discovery_only',
}

export const VEHICLE_APPROVAL_THRESHOLDS = {
  TIER_1_MIN_CONFIDENCE: 0.9,
  TIER_1_MIN_QUALITY: 70,
  TIER_2_MIN_CONFIDENCE: 0.7,
  TIER_2_MIN_QUALITY: 45,
} as const;

export const CRITICAL_WARNING_TAGS = [
  'missing_make',
  'missing_model',
  'missing_production_years',
  'inconsistent_engine_fuel',
  'version_engine_mismatch',
  'conflicting_fuel_type',
] as const;

export const REQUIRED_CANONICAL_FIELDS = [
  'make',
  'model',
  'version',
  'productionYears',
  'engine.fuelType',
] as const;
