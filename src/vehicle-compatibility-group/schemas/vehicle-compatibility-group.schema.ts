import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VehicleCompatibilityGroupDocument = VehicleCompatibilityGroupModel & Document;

@Schema({ collection: 'vehicle_compatibility_groups', timestamps: true })
export class VehicleCompatibilityGroupModel {
  @Prop({ required: true, index: true }) name: string;
  @Prop({ type: [String], required: true }) vehicleIds: string[];
  @Prop() lastEditedBy?: string;
}

export const VehicleCompatibilityGroupSchema = SchemaFactory.createForClass(VehicleCompatibilityGroupModel);
