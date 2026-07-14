import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryHintDocument = HydratedDocument<CategoryHintModel>;

/**
 * Aprendizado displayName -> categoria (contagem de uso), ver
 * docs/superpowers/specs/2026-07-13-product-display-name-category-hint-design.md.
 * Dono exclusivo: CategoryHintService.
 */
@Schema({ collection: 'display_name_category_hints', timestamps: false })
export class CategoryHintModel {
    _id: string;

    @Prop({ required: true, index: true })
    displayNameNormalized: string;

    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', required: true })
    categoryId: Types.ObjectId;

    @Prop({ default: 1 })
    count: number;

    @Prop({ default: () => new Date() })
    lastUsedAt: Date;
}

export const CategoryHintSchema = SchemaFactory.createForClass(CategoryHintModel);

CategoryHintSchema.index({ displayNameNormalized: 1, categoryId: 1 }, { unique: true });
