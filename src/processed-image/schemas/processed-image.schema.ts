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

  /**
   * Identity of the rembg job that produced this image. Unique (sparse) so a retried
   * or duplicated success callback upserts the SAME row instead of creating a second
   * repository entry — the guarantee that a paid processing result is recorded exactly
   * once. Omitted (not stored) for images created outside the rembg job flow (AI
   * generation, repository imports) — a sparse index only skips fields that are
   * absent, so an explicit `null` here would still collide across those documents.
   */
  @Prop()
  jobId?: string;
}

export const ProcessedImageSchema = SchemaFactory.createForClass(ProcessedImage);

ProcessedImageSchema.index({ createdAt: -1 });
ProcessedImageSchema.index({ batchCode: 1, createdAt: -1 });
ProcessedImageSchema.index({ jobId: 1 }, { unique: true, sparse: true });
