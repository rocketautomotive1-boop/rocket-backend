import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  VehicleDiscoverySource,
  VehicleDiscoveryStatus,
  VehicleReviewStatus,
} from '../../vehicle-shared/types/vehicle.types';

export type VehicleDiscoveryDocument = VehicleDiscoveryModel & Document;

@Schema({ _id: false })
class DiscoveryInputSchema {
  @Prop() title?: string;
  @Prop() description?: string;
  @Prop({ index: true }) make?: string;
  @Prop({ index: true }) model?: string;
  @Prop() version?: string;
  @Prop() engine?: string;
  @Prop({ type: [Number], default: [] }) years?: number[];
  @Prop() source?: string;
  @Prop({ index: true }) sourceItemId?: string;
  @Prop() sourceUrl?: string;
  @Prop() marketplace?: string;
  @Prop({ type: Object }) rawData?: Record<string, any>;
}

@Schema({ _id: false })
class StatusHistoryEntry {
  @Prop({ required: true }) status: string;
  @Prop({ type: Date, default: Date.now }) at: Date;
  @Prop() reason?: string;
  @Prop() by?: string;
}

@Schema({ collection: 'vehicle_discoveries', timestamps: true })
export class VehicleDiscoveryModel {
  @Prop({ type: DiscoveryInputSchema, required: true })
  input: DiscoveryInputSchema;

  @Prop({ type: Object })
  ai?: Record<string, any>;

  @Prop({ type: Object })
  canonical?: Record<string, any>;

  @Prop({
    required: true,
    enum: Object.values(VehicleDiscoveryStatus),
    default: VehicleDiscoveryStatus.PENDING,
    index: true,
  })
  status: VehicleDiscoveryStatus;

  @Prop({
    required: true,
    enum: Object.values(VehicleDiscoverySource),
    default: VehicleDiscoverySource.AI,
  })
  source: VehicleDiscoverySource;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: [String], default: [] })
  logs: string[];

  @Prop({ type: [StatusHistoryEntry], default: [] })
  statusHistory: StatusHistoryEntry[];

  @Prop({ type: Date }) processedAt?: Date;
  @Prop({ type: Date }) approvedAt?: Date;
  @Prop({ type: Date }) rejectedAt?: Date;

  @Prop() aiModel?: string;
  @Prop({ default: 'v1.0.0' }) aiPromptVersion?: string;
  @Prop({ type: Object }) aiRawResponse?: Record<string, any>;

  @Prop() errorMessage?: string;
  @Prop({ default: 0 }) retryCount: number;

  @Prop({ index: true, sparse: true })
  lockKey?: string;

  @Prop({ type: Number, default: 5, index: true })
  priority: number;

  @Prop({ default: false, index: true })
  needsReprocessing: boolean;

  @Prop({
    enum: Object.values(VehicleReviewStatus),
    default: VehicleReviewStatus.PENDING_REVIEW,
    index: true,
  })
  reviewStatus: VehicleReviewStatus;

  @Prop() reviewReason?: string;
  @Prop() reviewedBy?: string;
  @Prop({ type: Date }) reviewedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'VehicleCompatibilityModel', index: true })
  compatibilityId?: Types.ObjectId;
}

export const VehicleDiscoverySchema = SchemaFactory.createForClass(VehicleDiscoveryModel);

VehicleDiscoverySchema.index({ status: 1, priority: -1, createdAt: 1 });
VehicleDiscoverySchema.index({ needsReprocessing: 1, status: 1, createdAt: 1 });
VehicleDiscoverySchema.index(
  { lockKey: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { status: { $in: ['pending', 'processing'] } },
  },
);
VehicleDiscoverySchema.index({ 'input.make': 1, 'input.model': 1 });
VehicleDiscoverySchema.index({ 'canonical.make': 1, 'canonical.model': 1 });
