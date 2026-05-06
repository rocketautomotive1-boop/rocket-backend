import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VehicleAiCacheDocument = VehicleAiCacheModel & Document;

@Schema({ collection: 'vehicle_ai_cache', timestamps: true })
export class VehicleAiCacheModel {
  @Prop({ required: true, unique: true, index: true })
  cacheKey: string;

  @Prop({ required: true, index: true })
  aiPromptVersion: string;

  @Prop({ type: Object, required: true })
  aiOutput: Record<string, any>;

  @Prop()
  rawResponse?: string;

  @Prop({ required: true })
  aiModel: string;

  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt: Date;
}

export const VehicleAiCacheSchema = SchemaFactory.createForClass(VehicleAiCacheModel);
