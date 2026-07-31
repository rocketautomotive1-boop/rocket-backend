import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TitleCategoryHintDocument = HydratedDocument<TitleCategoryHintModel>;

/**
 * Aprendizado titleId -> categoria (contagem de uso). Substitui
 * display_name_category_hints: como titleId já é canônico (sinônimos
 * resolvem para o mesmo ProductShortTitle), não precisa de mineração nem
 * fila de candidatos — só a contagem direta.
 */
@Schema({ collection: 'title_category_hints', timestamps: false })
export class TitleCategoryHintModel {
    _id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductShortTitleModel', required: true, index: true })
    titleId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', required: true })
    categoryId: Types.ObjectId;

    @Prop({ default: 1 })
    count: number;

    @Prop({ default: () => new Date() })
    lastUsedAt: Date;
}

export const TitleCategoryHintSchema = SchemaFactory.createForClass(TitleCategoryHintModel);

TitleCategoryHintSchema.index({ titleId: 1, categoryId: 1 }, { unique: true });
