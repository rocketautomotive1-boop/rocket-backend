import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { VehicleBodyType, VehicleMarket, VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';

export type VehicleCompatibilityDocument = VehicleCompatibilityModel & Document;

@Schema({ _id: false })
class EngineExtraSchema {
  @Prop() powerHp?: number;
}

@Schema({ _id: false })
class DimensionsExtraSchema {
  @Prop() fuelCapacityL?: number;
  @Prop() heightMm?: number;
  @Prop() lengthMm?: number;
  @Prop() passengerCapacity?: number;
  @Prop() wheelbaseMm?: number;
  @Prop() widthMm?: number;
}

/**
 * Metadado de origem anexado a QUALQUER seção que possa vir de fonte diferente
 * (OEM/FIPE/ML/manual). Não é valor de negócio — é "de onde veio isso e quando",
 * usado pelo merge por seção em upsertByCanonicalKey (ver vehicle-schema-design
 * doc: OEM vence em powertrain/chassisAndDynamics/safetyAndAdas/warranty, FIPE
 * vence em fipe.*, manual sempre vence, ML só é insubstituível em mlVehicleId).
 */
@Schema({ _id: false })
class ProvenanceSchema {
  @Prop({ enum: ['oem', 'fipe', 'ml', 'manual'], required: true }) sourceType: string;
  @Prop() sourceId?: string; // ex: "oem_denza", "fipe_306001-2", "ml_MLB123"
  @Prop({ required: true }) fetchedAt: Date;
  @Prop({ enum: ['high', 'medium', 'low'], default: 'medium' }) confidence: string;
}

@Schema({ _id: false })
class PowertrainSchema {
  @Prop() energyType?: string;
  @Prop() driveType?: string;
  @Prop() smartAwd?: boolean;
  @Prop() lowRange4x4?: boolean;
  @Prop({ type: Object }) frontMotor?: { powerKw?: number; torqueNm?: number };
  @Prop({ type: Object }) rearMotor?: { powerKw?: number; torqueNm?: number };
  @Prop({ type: Object }) combustionEngine?: {
    layout?: string;
    aspiration?: string;
    displacementCc?: number;
    powerKw?: number;
    torqueNm?: number;
  };
  @Prop({ type: Object }) combinedOutput?: { powerKw?: number; torqueNm?: number };
  @Prop({ type: Object }) battery?: { chemistry?: string; capacityKwh?: number; cellToChassis?: boolean };
  @Prop() fuelTankCapacityL?: number;
  @Prop() accelerationSec0to100?: number;
  @Prop() electricRangeKm?: number;
  @Prop() combinedRangeKm?: number;
  @Prop({ type: Object }) charging?: {
    acKw1Phase?: number;
    acKw3Phase?: number;
    dcFastKw?: number;
    scheduledCharging?: boolean;
    v2l?: boolean;
    portableCable?: boolean;
  };
  @Prop() regenerativeBraking?: boolean;
  @Prop({ type: Object }) differentialLock?: { front?: boolean; rear?: boolean };
  @Prop({ type: Object }) towing?: { brakedKg?: number; unbrakedKg?: number; hasHitchReceiver?: boolean };
}

@Schema({ _id: false })
class ChassisAndDynamicsSchema {
  @Prop() frontSuspension?: string;
  @Prop() rearSuspension?: string;
  @Prop({ type: Object }) adaptiveSuspension?: { type?: string; travelMm?: number };
  @Prop() frontBrakeType?: string;
  @Prop() rearBrakeType?: string;
  @Prop() wheelMaterial?: string;
  @Prop() wheelSizeIn?: number;
  @Prop() tireSize?: string;
  @Prop({ type: [String] }) tireBrands?: string[];
  @Prop() hasMatchingSpare?: boolean;
  @Prop({ type: [String] }) drivingModes?: string[];
  @Prop() approachAngleDeg?: number;
  @Prop() departureAngleDeg?: number;
  @Prop() groundClearanceMm?: number;
  @Prop() turningRadiusM?: number;
}

/**
 * ~48 flags booleanas/numéricas nomeadas — mapa plano, não array de strings,
 * para permitir query direta tipo { "safetyAndAdas.aeb": true }. strict:false
 * aceita chaves de ADAS não previstas aqui sem exigir migration a cada
 * fabricante novo importado (cada montadora usa siglas próprias).
 */
@Schema({ _id: false, strict: false })
class SafetyAndAdasSchema {
  @Prop({ type: Object }) airbags?: { count?: number; frontal?: boolean; lateral?: boolean; curtain?: boolean; driverKnee?: boolean };
  @Prop() abs?: boolean;
  @Prop() esc?: boolean;
  @Prop() aeb?: boolean;
  @Prop() acc?: boolean;
  @Prop() tpms?: boolean;
  @Prop() blindSpotDetection?: boolean;
  @Prop() laneDepartureAssist?: boolean;
  @Prop() laneCenteringAssist?: boolean;
  @Prop() frontCrossTrafficAlert?: boolean;
  @Prop() frontCrossTrafficBraking?: boolean;
  @Prop() rearCrossTrafficAlert?: boolean;
  @Prop() rearCrossTrafficBraking?: boolean;
  @Prop() forwardCollisionWarning?: boolean;
  @Prop() rearCollisionWarning?: boolean;
  @Prop() hillDescentControl?: boolean;
  @Prop() hillHoldControl?: boolean;
  @Prop() camera360?: boolean;
  @Prop() highPerceptionCamera?: boolean;
  @Prop() isofix?: boolean;
  @Prop({ type: Object }) parkingSensors?: { front?: number; rear?: number };
  @Prop() trailerStabilityControl?: boolean;
  @Prop() rollMovementIntervention?: boolean;
  @Prop() trafficSignRecognition?: boolean;
  @Prop() headUpDisplayIn?: number;
}

@Schema({ _id: false, strict: false })
class EquipmentSchema {
  @Prop({ type: Object }) exterior?: { lighting?: Record<string, boolean>; sunroofType?: string; roofRack?: boolean; sideStepType?: string };
  @Prop({ type: Object }) interior?: {
    upholstery?: string;
    seatConfig?: string;
    seatAdjustPositions?: Record<string, number>;
    frontSeats?: { massage?: boolean; ventilation?: boolean; heating?: boolean };
    rearSeats?: { heating?: boolean; ventilation?: boolean; splitFold?: string };
    climateControl?: string;
    wirelessChargersCount?: number;
  };
  @Prop({ type: Object }) infotainment?: {
    systemName?: string;
    clusterIn?: number;
    centralDisplayIn?: number;
    audioSystem?: { brand?: string; speakerCount?: number; watts?: number };
    connectivity?: { has4g?: boolean; ota?: boolean; appServices?: string[]; keyTypes?: string[] };
  };
}

@Schema({ _id: false })
class WarrantySchema {
  @Prop() durationMonths?: number;
  @Prop() kmLimitPrivate?: number;
  @Prop() kmLimitCommercial?: number;
  @Prop() startsAt?: string;
  @Prop() coversManufacturingDefects?: boolean;
  @Prop() requiresAuthorizedMaintenance?: boolean;
}

@Schema({ collection: 'vehicle_compatibilities', timestamps: true })
export class VehicleCompatibilityModel {
  // Versão do formato do documento — controla que campos/seções o merge por
  // seção (upsertByCanonicalKey) espera encontrar. Aditivo: documentos sem
  // este campo são tratados como schemaVersion 1 (sem seções v2 nem provenance).
  @Prop({ default: 1, index: true }) schemaVersion: number;
  // Identidade / exibição (texto original)
  @Prop({ required: true, index: true }) make: string;
  @Prop({ required: true, index: true }) model: string;
  @Prop({ required: true, index: true }) version: string;
  @Prop() versionDisplay?: string;

  // Chaves de comparação (lowercase/sem-acento) — usadas por filtro estruturado e Atlas Search
  @Prop({ required: true, index: true }) makeKey: string;
  @Prop({ required: true, index: true }) modelKey: string;
  @Prop({ required: true, index: true }) versionKey: string;

  @Prop({ enum: Object.values(VehicleMarket), default: VehicleMarket.BR, index: true })
  market: VehicleMarket;

  // Motor — achatado, direto na raiz
  @Prop() engineDisplay?: string;
  @Prop({ type: Number, index: true }) displacementCc?: number;
  @Prop() fuelType?: string;
  @Prop({ type: [String], index: true }) fuelTags?: string[];
  @Prop({ type: EngineExtraSchema }) engine?: EngineExtraSchema;

  @Prop({ type: [String], index: true }) transmission?: string[];
  @Prop({ type: [Number], index: true }) years?: number[];

  // Carroceria / trim / picape
  @Prop({ type: Number, index: true }) doors?: number;
  @Prop() trim?: string;
  @Prop({ enum: ['4x2', '4x4', 'awd'], index: true }) traction?: string;
  @Prop({ enum: ['simples', 'dupla'], index: true }) cabType?: string;
  @Prop({ enum: Object.values(VehicleBodyType), index: true }) bodyType?: string;
  /** Dimensões físicas restantes: length/height/width/wheelbase/fuelCapacity/passengerCapacity (mm/L/un). */
  @Prop({ type: DimensionsExtraSchema }) dimensions?: DimensionsExtraSchema;

  @Prop({ index: true }) platform?: string;
  @Prop() generation?: string;
  @Prop() facelift?: string;
  @Prop() segment?: string;

  @Prop({ type: Object }) fipe?: Record<string, any>;
  @Prop({ type: ProvenanceSchema }) fipe_provenance?: ProvenanceSchema;
  /** Opcionais/equipamentos presentes (ex: "abs", "airbag_passageiro", "android_auto"). */
  @Prop({ type: [String], index: true }) features?: string[];

  @Prop({ type: [String], index: true }) aliases?: string[];
  @Prop({ type: [String] }) tags?: string[];
  @Prop({ index: true }) searchText?: string;

  @Prop({ default: true, index: true }) active: boolean;

  @Prop({ enum: Object.values(VehicleOrigin), required: true, index: true })
  origin: VehicleOrigin;

  /** Id numérico da taxonomia do catálogo ML — necessário para sync de compatibilidade de volta ao ML. */
  @Prop({ index: true }) mlVehicleId?: string;

  @Prop() lastEditedBy?: string;
  @Prop() lastEditedAt?: Date;

  @Prop({ unique: true, required: true, index: true }) canonicalKey: string;
  @Prop({ type: Number, default: 0, index: true }) dataQualityScore: number;

  // ---- v2: seções ricas de ficha técnica de fabricante, cada uma com sua
  // própria proveniência — ver docs do schema v2 (Denza B5 case study).
  @Prop({ type: PowertrainSchema }) powertrain?: PowertrainSchema;
  @Prop({ type: ProvenanceSchema }) powertrain_provenance?: ProvenanceSchema;

  @Prop({ type: ChassisAndDynamicsSchema }) chassisAndDynamics?: ChassisAndDynamicsSchema;
  @Prop({ type: ProvenanceSchema }) chassisAndDynamics_provenance?: ProvenanceSchema;

  @Prop({ type: SafetyAndAdasSchema }) safetyAndAdas?: SafetyAndAdasSchema;
  @Prop({ type: ProvenanceSchema }) safetyAndAdas_provenance?: ProvenanceSchema;

  @Prop({ type: EquipmentSchema }) equipment?: EquipmentSchema;
  @Prop({ type: ProvenanceSchema }) equipment_provenance?: ProvenanceSchema;

  @Prop({ type: WarrantySchema }) warranty?: WarrantySchema;
  @Prop({ type: ProvenanceSchema }) warranty_provenance?: ProvenanceSchema;

  @Prop({ type: [String] }) exteriorColors?: string[];
  @Prop({ type: [String] }) interiorColors?: string[];
  @Prop({ type: [String] }) ownerBenefits?: string[];
  @Prop({ type: ProvenanceSchema }) colors_provenance?: ProvenanceSchema;
}

export const VehicleCompatibilitySchema = SchemaFactory.createForClass(VehicleCompatibilityModel);

VehicleCompatibilitySchema.index({ makeKey: 1, modelKey: 1, versionKey: 1 });
VehicleCompatibilitySchema.index({ make: 1, model: 1, years: 1 });
VehicleCompatibilitySchema.index({ active: 1, market: 1 });
VehicleCompatibilitySchema.index({ searchText: 'text' });
VehicleCompatibilitySchema.index({ trim: 1 });
