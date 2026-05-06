import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  VehicleBodyType,
  VehicleMarket,
  VehicleReviewStatus,
  VehicleSourceType,
} from '../../vehicle-shared/types/vehicle.types';
import { VehicleApprovalTier } from '../../vehicle-shared/constants/vehicle.constants';

export type VehicleCompatibilityDocument = VehicleCompatibilityModel & Document;

@Schema({ _id: false })
class ProductionYearsSchema {
  @Prop({ required: true }) from: number;
  @Prop({ required: true }) to: number;
}

@Schema({ _id: false })
class CompatibilityNormalizedSchema {
  @Prop({ required: true }) make: string;
  @Prop({ required: true }) model: string;
  @Prop({ required: true }) version: string;
  @Prop() versionDisplay?: string;
  @Prop({ type: [String] }) engineTokens?: string[];
}

@Schema({ collection: 'vehicle_compatibilities', timestamps: true })
export class VehicleCompatibilityModel {
  @Prop({ required: true, index: true }) make: string;
  @Prop({ required: true, index: true }) model: string;
  @Prop({ required: true, index: true }) version: string;
  @Prop() versionDisplay?: string;

  @Prop({ enum: Object.values(VehicleMarket), default: VehicleMarket.BR, index: true })
  market: VehicleMarket;

  @Prop({ type: Object }) engine?: Record<string, any>;
  @Prop({ type: [String], index: true }) transmission?: string[];
  @Prop({ type: ProductionYearsSchema }) productionYears?: ProductionYearsSchema;
  @Prop({ type: [Number], index: true }) years?: number[];
  @Prop({ type: Object }) fuel?: Record<string, any>;

  @Prop({ index: true }) platform?: string;
  @Prop() generation?: string;
  @Prop() facelift?: string;
  @Prop({ enum: Object.values(VehicleBodyType), index: true }) bodyType?: string;
  @Prop() segment?: string;

  @Prop({ type: Object }) fipe?: Record<string, any>;
  @Prop({ type: Object }) chassis?: Record<string, any>;

  @Prop({ type: CompatibilityNormalizedSchema, required: true })
  normalized: CompatibilityNormalizedSchema;

  @Prop({ type: [String], index: true }) aliases?: string[];
  @Prop({ type: [String] }) tags?: string[];
  @Prop({ index: true }) searchText?: string;

  @Prop({ default: true, index: true }) active: boolean;
  @Prop({ enum: Object.values(VehicleSourceType) }) sourceType?: VehicleSourceType;
  @Prop({ type: Types.ObjectId, ref: 'VehicleDiscoveryModel', index: true }) sourceDiscoveryId?: Types.ObjectId;
  @Prop({ type: Number }) confidence?: number;
  @Prop({ enum: Object.values(VehicleReviewStatus) }) reviewStatus?: VehicleReviewStatus;

  @Prop({ unique: true, required: true, index: true }) canonicalKey: string;
  @Prop({ default: 'v1', index: true }) canonicalVersion: string;
  @Prop({ default: 'v1', index: true }) normalizerVersion: string;
  @Prop({ enum: Object.values(VehicleApprovalTier) }) approvalTier?: string;
  @Prop({ type: Number, default: 0, index: true }) dataQualityScore: number;
}

export const VehicleCompatibilitySchema = SchemaFactory.createForClass(VehicleCompatibilityModel);

VehicleCompatibilitySchema.index({ 'normalized.make': 1, 'normalized.model': 1, 'normalized.version': 1 });
VehicleCompatibilitySchema.index({ make: 1, model: 1, years: 1 });
VehicleCompatibilitySchema.index({ 'engine.code': 1 });
VehicleCompatibilitySchema.index({ 'engine.family': 1 });
VehicleCompatibilitySchema.index({ active: 1, market: 1 });
VehicleCompatibilitySchema.index({ searchText: 'text' });
