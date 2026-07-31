import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProductShortTitleDocument = HydratedDocument<ProductShortTitleModel>;

/**
 * Nome curto reutilizável entre produtos (ex: "Parafuso"), com sinônimos
 * próprios (ex: "Parafuso" ~ "Rosca"). Substitui Product.displayName —
 * ver docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
 * Product referencia via titleId; Product.subtitle é texto livre, sem
 * sinônimo (ex: "Dianteiro do Virabrequim").
 */
@Schema({ collection: 'product_short_titles', timestamps: true })
export class ProductShortTitleModel {
    _id: string;

    @Prop({ required: true })
    text: string;

    @Prop({ required: true, unique: true, index: true })
    textNormalized: string;

    // Normalizados (mesma regra de textNormalized), resolvem para este _id.
    @Prop({ type: [String], default: [], index: true })
    synonyms: string[];

    // Contagem de produtos vinculados — usada para ranking no picker/autocomplete.
    @Prop({ default: 0 })
    usageCount: number;
}

export const ProductShortTitleSchema = SchemaFactory.createForClass(ProductShortTitleModel);
