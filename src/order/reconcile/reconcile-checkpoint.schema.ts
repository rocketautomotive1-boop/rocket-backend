import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconcileCheckpointDocument = HydratedDocument<ReconcileCheckpointModel>;

/**
 * High-water-mark for the order reconciler, per (marketplace, account). Persists the cursor
 * so the incremental delta poll survives restarts and never re-scans history. Multi-client:
 * each account[] has its own cursor; `accountId` ausente = conta default (single-client legado).
 */
@Schema({ collection: 'reconcile_checkpoints', timestamps: true })
export class ReconcileCheckpointModel {
  @Prop({ required: true })
  marketplaceId: string;

  /** Conta multi-client. Ausente (null) = checkpoint da conta default/legado. */
  @Prop({ default: null })
  accountId?: string | null;

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
// Cursor único por (marketplace, conta). accountId null = conta default.
ReconcileCheckpointSchema.index({ marketplaceId: 1, accountId: 1 }, { unique: true });
