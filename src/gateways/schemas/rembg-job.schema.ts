import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RembgJobDocument = HydratedDocument<RembgJob>;

@Schema({ collection: 'rembg_jobs', timestamps: true })
export class RembgJob {
  @Prop({ required: true, index: true })
  productId: string;

  @Prop({ required: true })
  rawS3Key: string;

  @Prop({ required: true, index: true })
  batchCode: string;

  @Prop({ default: null })
  batchNote: string | null;

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'done', 'failed'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'processing' | 'done' | 'failed';

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: null })
  nextRetryAt: Date | null;

  @Prop({ default: null })
  processedImageKey: string | null;
}

export const RembgJobSchema = SchemaFactory.createForClass(RembgJob);
RembgJobSchema.index({ status: 1, nextRetryAt: 1 });
