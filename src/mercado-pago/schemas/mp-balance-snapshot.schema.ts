import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MpBalanceSnapshotDocument = HydratedDocument<MpBalanceSnapshotModel>;

/**
 * Cache do saldo DISPONÍVEL do Mercado Pago.
 *
 * O saldo disponível ("Saldo" no painel MP) só é obtível via release_report
 * (assíncrono, gera CSV). Para responder o comando "saldo" do WhatsApp na hora,
 * um job periódico gera o report, extrai o BALANCE_AMOUNT da última linha e grava
 * aqui. `getBalance()` lê este snapshot + soma o "a liberar" (síncrono via payments).
 *
 * Singleton por conta: chave = `accountId` (userId do MP). Upsert no refresh.
 */
@Schema({ collection: 'mp_balance_snapshots', timestamps: true })
export class MpBalanceSnapshotModel {
  /** userId/accountId do Mercado Pago (dono do saldo). */
  @Prop({ required: true, unique: true, index: true })
  accountId: string;

  /** Saldo disponível em BRL (BALANCE_AMOUNT da última linha do release_report). */
  @Prop({ required: true, default: 0 })
  available: number;

  /** Quando o report que originou este saldo foi lido. */
  @Prop({ required: true })
  capturedAt: Date;
}

export const MpBalanceSnapshotSchema = SchemaFactory.createForClass(MpBalanceSnapshotModel);
