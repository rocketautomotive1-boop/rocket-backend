import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlateLookupCacheDocument = PlateLookupCacheModel & Document;

@Schema({ collection: 'plate_lookup_cache', timestamps: true })
export class PlateLookupCacheModel {
  @Prop({ required: true, unique: true, index: true }) plate: string;
  @Prop({ type: Object }) rawResponse: Record<string, any>;
  @Prop({ required: true }) make: string;
  @Prop({ required: true }) model: string;
  @Prop() year?: number;
  @Prop() fuel?: string;
  @Prop() engine?: string;
  @Prop({ required: true, expires: 0 }) expiresAt: Date;
}

export const PlateLookupCacheSchema = SchemaFactory.createForClass(PlateLookupCacheModel);
