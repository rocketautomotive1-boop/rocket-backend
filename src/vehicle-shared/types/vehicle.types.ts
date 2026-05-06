export enum VehicleDiscoveryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ERROR = 'error',
}

export enum VehicleDiscoverySource {
  AI = 'ai',
  MANUAL = 'manual',
  CATALOG = 'catalog',
  HYBRID = 'hybrid',
}

export enum VehicleReviewStatus {
  PENDING_REVIEW = 'pending_review',
  AUTO_APPROVED = 'auto_approved',
  MANUALLY_APPROVED = 'manually_approved',
  REJECTED = 'rejected',
}

export enum VehicleBodyType {
  SEDAN = 'sedan',
  HATCH = 'hatch',
  SUV = 'suv',
  PICKUP = 'pickup',
  MINIVAN = 'minivan',
  COUPE = 'coupe',
  WAGON = 'wagon',
  VAN = 'van',
  CONVERTIBLE = 'convertible',
  CROSSOVER = 'crossover',
  TRUCK = 'truck',
  OTHER = 'other',
}

export enum VehicleMarket {
  BR = 'BR',
  LATAM = 'LATAM',
  GLOBAL = 'GLOBAL',
}

export enum VehicleFuelType {
  GASOLINE = 'gasoline',
  ETHANOL = 'ethanol',
  FLEX = 'flex',
  DIESEL = 'diesel',
  HYBRID = 'hybrid',
  ELECTRIC = 'electric',
  CNG = 'cng',
}

export enum VehicleAspiration {
  NATURALLY_ASPIRATED = 'naturally_aspirated',
  TURBO = 'turbo',
  SUPERCHARGED = 'supercharged',
  TURBO_SUPERCHARGED = 'turbo_supercharged',
}

export enum VehicleSourceType {
  OFFICIAL_CATALOG = 'official_catalog',
  AI_INFERENCE = 'ai_inference',
  MANUAL_REVIEW = 'manual_review',
  MARKETPLACE = 'marketplace',
}

export interface VehicleEngineData {
  code?: string;
  displacement?: string;
  family?: string;
  aspiration?: VehicleAspiration | string;
  fuelType?: VehicleFuelType | string;
  valvetrain?: string;
  cylinders?: number;
  layout?: string;
  powerCvGasoline?: number;
  powerCvEthanol?: number;
  torqueNm?: number;
  fuel?: string[];
}

export interface VehicleFipeData {
  code?: string;
  description?: string;
  reference?: string;
  value?: number;
  lastUpdate?: Date;
}

export interface VehicleProductionYears {
  from: number;
  to: number;
}

export interface VehicleNormalized {
  make: string;
  model: string;
  version: string;
  versionDisplay: string;
  engineTokens: string[];
}

export interface VehicleChassisData {
  platformCode?: string;
  vinPrefix?: string;
  applicableChassis?: string[];
}

export interface VehicleAiOutput {
  make?: string;
  model?: string;
  version?: string;
  versionStandard?: string;
  productionYears?: number[];
  bodyType?: string;
  platform?: string;
  generation?: string;
  facelift?: string;
  engine?: {
    displacement?: string;
    family?: string;
    aspiration?: string;
    fuelType?: string;
    valvetrain?: string;
    powerCvGasoline?: number;
    powerCvEthanol?: number;
    torqueNm?: number;
  };
  transmission?: string[];
  fuelType?: string;
  fipe?: {
    code?: string;
    description?: string;
    reference?: string;
    value?: number;
  };
  aliases?: string[];
  tags?: string[];
  confidence?: number | null;
  warnings?: string[];
  missingFields?: string[];
}
