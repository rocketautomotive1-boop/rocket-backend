import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconcileCheckpointDocument = HydratedDocument<ReconcileCheckpointModel>;

/**
 * Per-marketplace high-water-mark for the order reconciler. Persists the cursor so the
 * incremental delta poll survives restarts and never re-scans history.
 */
@Schema({ collection: 'reconcile_checkpoints', timestamps: true })
export class ReconcileCheckpointModel {
  @Prop({ required: true, unique: true })
  marketplaceId: string;

  @Prop({ required: true })
  lastUpdatedCursor: Date;

  @Prop()
  lastRunAt: Date;

  @Prop({ default: 0 })
  consecutiveCleanRuns: number;

  @Prop({ default: 5 * 60 * 1000 })
  currentIntervalMs: number;
}

export const ReconcileCheckpointSchema = SchemaFactory.createForClass(ReconcileCheckpointModel);
