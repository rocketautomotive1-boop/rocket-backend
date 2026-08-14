export enum VehicleOrigin {
  ML_IMPORT = 'ml_import',
  MANUAL = 'manual',
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
