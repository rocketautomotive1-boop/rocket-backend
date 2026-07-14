export const VEHICLE_CONSTANTS = {
  CANONICAL_VERSION: 'v1',
  MIN_PRODUCTION_YEAR: 1900,
  MAX_PRODUCTION_YEAR: new Date().getFullYear() + 2,
  ML_IMPORT_ATTRIBUTE_ORDER: [
    'BRAND',
    'MODEL',
    'VEHICLE_YEAR',
    'TRIM',
    'ENGINE',
    'FUEL_TYPE',
    'TRANSMISSION',
    'VEHICLE_BODY_TYPE',
  ],
} as const;

export const REQUIRED_CANONICAL_FIELDS = [
  'make',
  'model',
  'version',
] as const;
