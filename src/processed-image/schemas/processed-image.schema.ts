import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProcessedImageDocument = HydratedDocument<ProcessedImage>;

@Schema({ collection: 'processed_images', timestamps: true })
export class ProcessedImage {
  @Prop({ required: true, index: true })
  batchCode: string;

  @Prop({ default: null, index: true })
  batchNote?: string | null;

  @Prop({ default: null, index: true })
  productId?: string | null;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true, index: true })
  key: string;

  @Prop({ default: 'image/png' })
  mimeType?: string;

  @Prop({ default: null })
  fileName?: string | null;

  @Prop({ default: null })
  source?: string | null;
}

export const ProcessedImageSchema = SchemaFactory.createForClass(ProcessedImage);

ProcessedImageSchema.index({ createdAt: -1 });
ProcessedImageSchema.index({ batchCode: 1, createdAt: -1 });
