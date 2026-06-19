import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionReconcileCheckpointDocument = HydratedDocument<QuestionReconcileCheckpointModel>;

@Schema({ collection: 'question_reconcile_checkpoints', timestamps: true })
export class QuestionReconcileCheckpointModel {
  @Prop({ required: true, unique: true })
  marketplaceId: string;

  @Prop({ required: true })
  lastCreatedCursor: Date;

  @Prop()
  lastRunAt: Date;

  @Prop({ default: 0 })
  consecutiveCleanRuns: number;

  @Prop({ default: 5 * 60 * 1000 })
  currentIntervalMs: number;
}

export const QuestionReconcileCheckpointSchema = SchemaFactory.createForClass(QuestionReconcileCheckpointModel);
