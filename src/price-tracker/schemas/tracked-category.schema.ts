import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TrackedCategoryDocument = HydratedDocument<TrackedCategoryModel>;

/** Categoria livre criada pelo usuário para organizar os itens monitorados. */
@Schema({ collection: 'tracked_categories', timestamps: true })
export class TrackedCategoryModel {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  name: string;

  createdAt: Date;
  updatedAt: Date;
}

export const TrackedCategorySchema = SchemaFactory.createForClass(TrackedCategoryModel);
