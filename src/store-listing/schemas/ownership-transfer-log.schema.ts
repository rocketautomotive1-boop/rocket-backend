import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type OwnershipTransferLogDocument = HydratedDocument<OwnershipTransferLogModel>;

export type OwnershipTransferKind = 'repoint' | 'merge';

/**
 * Registro imutável de toda transferência de propriedade executada por
 * StoreListingOwnershipService.transferOwnership — a única forma permitida de mudar o storeId de
 * um listing/StoreListing. Existe porque a mesma classe de bug (storeId corrigido sem mover os
 * dados derivados) já causou incidente uma vez (achado 2026-08-30, 883 casos); sem trilha de
 * auditoria, a próxima investigação começa do zero de novo.
 */
@Schema({ collection: 'ownership_transfer_logs', timestamps: true })
export class OwnershipTransferLogModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  fromStoreId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  toStoreId: Types.ObjectId;

  @Prop({ type: String, enum: ['repoint', 'merge'], required: true })
  kind: OwnershipTransferKind;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  sourceStoreListingId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  destinationStoreListingId: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  reason: string;

  @Prop({ type: String, default: null })
  triggeredBy: string | null;
}

export const OwnershipTransferLogSchema = SchemaFactory.createForClass(OwnershipTransferLogModel);

OwnershipTransferLogSchema.index({ productId: 1, createdAt: -1 });
