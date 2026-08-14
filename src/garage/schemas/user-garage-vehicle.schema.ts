import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserGarageVehicleDocument = UserGarageVehicleModel & Document;

@Schema({ collection: 'user_garage_vehicles', timestamps: true })
export class UserGarageVehicleModel {
  @Prop({ required: true, index: true }) userId: string;
  @Prop({ required: true }) vehicleId: string;
  @Prop({ required: true }) label: string;
  @Prop({ default: false }) active: boolean;
}

export const UserGarageVehicleSchema = SchemaFactory.createForClass(UserGarageVehicleModel);

UserGarageVehicleSchema.index({ userId: 1, active: 1 });
UserGarageVehicleSchema.index({ userId: 1, vehicleId: 1 }, { unique: true });
