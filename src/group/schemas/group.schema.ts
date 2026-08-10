import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GroupDocument = HydratedDocument<GroupModel>;

/**
 * Loja/grupo operacional (ex.: "Loja Centro", "Loja Sul"). Cardinalidade baixa
 * e fixa (poucas unidades) — sem CRUD dedicado, gerido via script/API interna.
 *
 * Dono da conta de publicação POR MARKETPLACE (multi-client): cada produto
 * herda, em runtime, o grupo do seu criador (`product.createdByUserId` →
 * `user.groupId`), e publica sempre na conta mapeada aqui — independente de
 * qual dispositivo/operador dispara o sync. Ver
 * docs/superpowers/specs/2026-08-10-multi-account-publishing-by-group-design.md.
 */
@Schema({ collection: 'groups', timestamps: true })
export class GroupModel {
  @Prop({ required: true, unique: true })
  name: string;

  /** marketplaceTag → accountId (o _id de uma entrada em marketplaces.accounts[]). */
  @Prop({ type: Object, default: {} })
  accounts: Record<string, string>;
}

export const GroupSchema = SchemaFactory.createForClass(GroupModel);
