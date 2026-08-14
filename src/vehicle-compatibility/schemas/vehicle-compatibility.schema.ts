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

@Schema({ collection: 'vehicle_compatibilities', timestamps: true })
export class VehicleCompatibilityModel {
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
}

export const VehicleCompatibilitySchema = SchemaFactory.createForClass(VehicleCompatibilityModel);

VehicleCompatibilitySchema.index({ makeKey: 1, modelKey: 1, versionKey: 1 });
VehicleCompatibilitySchema.index({ make: 1, model: 1, years: 1 });
VehicleCompatibilitySchema.index({ active: 1, market: 1 });
VehicleCompatibilitySchema.index({ searchText: 'text' });
VehicleCompatibilitySchema.index({ trim: 1 });
