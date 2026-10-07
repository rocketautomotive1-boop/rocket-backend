import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconcileCheckpointDocument = HydratedDocument<ReconcileCheckpointModel>;

/**
 * Pedido que falhou no ingest e aguarda nova tentativa. Vive no checkpoint para que uma falha
 * pontual (ex.: 404 transitório do ML) nunca trave o cursor nem se perca: o cursor avança e o
 * pedido é retentado com backoff até `dead` (esgotou tentativas — exige atenção humana, jamais
 * é descartado em silêncio).
 */
export class FailedRef {
  /** externalId do pedido (não usar `id`: colide com o virtual `id` de subdocumentos do Mongoose). */
  externalId: string;
  attempts: number;
  nextRetryAt: Date;
  lastError?: string;
  dead: boolean;
}

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

  /**
   * Próxima execução devida. Persistido (e não um timer em memória) para que a agenda
   * sobreviva a falhas e restarts: o tick do reconciler roda tudo com nextRunAt <= agora.
   * Ausente = devido imediatamente.
   */
  @Prop({ type: Date, default: null })
  nextRunAt?: Date | null;

  /** Último erro de execução (listagem do delta); limpo numa execução bem-sucedida. */
  @Prop({ type: String, default: null })
  lastError?: string | null;

  @Prop({
    type: [{
      _id: false,
      externalId: { type: String, required: true },
      attempts: { type: Number, default: 0 },
      nextRetryAt: { type: Date, required: true },
      lastError: { type: String },
      dead: { type: Boolean, default: false },
    }],
    default: [],
  })
  failedRefs: FailedRef[];
}

export const ReconcileCheckpointSchema = SchemaFactory.createForClass(ReconcileCheckpointModel);
// Cursor único por (marketplace, conta). accountId null = conta default.
ReconcileCheckpointSchema.index({ marketplaceId: 1, accountId: 1 }, { unique: true });
ReconcileCheckpointSchema.index({ nextRunAt: 1 });
