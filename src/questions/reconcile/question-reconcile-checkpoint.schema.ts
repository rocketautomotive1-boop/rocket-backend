import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionReconcileCheckpointDocument = HydratedDocument<QuestionReconcileCheckpointModel>;

@Schema({ collection: 'question_reconcile_checkpoints', timestamps: true })
export class QuestionReconcileCheckpointModel {
  @Prop({ required: true })
  marketplaceId: string;

  /** Conta multi-client. Ausente (null) = checkpoint da conta default/legado. */
  @Prop({ default: null })
  accountId?: string | null;

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
// Cursor único por (marketplace, conta). accountId null = conta default.
QuestionReconcileCheckpointSchema.index(
  { marketplaceId: 1, accountId: 1 },
  { unique: true, name: 'ux_question_checkpoint_marketplace_account' },
);
