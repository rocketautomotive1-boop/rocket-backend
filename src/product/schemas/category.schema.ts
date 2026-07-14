import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<CategoryModel>;

@Schema({ collection: 'categories', timestamps: true })
export class CategoryModel {
    id: string;

    @Prop({ required: true, index: true })
    name: string;

    @Prop({ required: true, unique: true, index: true })
    slug: string;

    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', index: true })
    parentId?: Types.ObjectId;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'CategoryModel' }], index: true })
    ancestors: Types.ObjectId[];

    @Prop()
    description?: string;

    @Prop({ default: true })
    active: boolean;

    @Prop({ default: false })
    hidden: boolean;

    @Prop()
    image?: string;

    @Prop()
    icon?: string; // lucide-react icon name, e.g. "Lightbulb", "Disc3"

    @Prop({ default: 0, index: true })
    relevance: number;

    /**
     * Peso manual de prioridade para o relevanceScore de produtos desta categoria (ex:
     * "Óleo de Motor" = 3). Sem herança pai→filho — cada categoria-folha configura o próprio
     * peso; ver docs/superpowers/specs/2026-07-13-product-relevance-rails-design.md.
     */
    @Prop({ default: 1 })
    priorityWeight: number;

    @Prop({ default: 0 })
    productCount: number;

    // --- SEO Fields ---
    @Prop()
    googleProductCategory?: string; // GPC ID

    @Prop()
    metaTitle?: string;

    @Prop()
    metaDescription?: string;

    @Prop({ type: [String] })
    synonyms: string[]; // Manual tuning keywords

    @Prop({ type: [String] })
    examples: string[]; // AI Generated examples

    @Prop()
    usageGuide: string; // AI Generated usage guide

    @Prop()
    aiReason: string; // Reason why AI selected/created this category

    @Prop()
    breadcrumbs?: string; // Pre-computed path string, e.g. "Freios > Discos e Pastilhas > Pastilha de Freio"

    @Prop({ type: [String] })
    attributes: string[]; // Relevant attributes for this category

    @Prop({
        type: [{
            marketplaceId: { type: Types.ObjectId, ref: 'MarketplaceModel' },
            externalId: String,
            externalName: String,
            path: String,
            attributeMappings: Object
        }],
        default: []
    })
    marketplaceMappings: Array<{
        marketplaceId: Types.ObjectId;
        externalId: string;
        externalName: string;
        path: string;
        attributeMappings: any;
    }>;
}

export const CategorySchema = SchemaFactory.createForClass(CategoryModel);

// Compound index for efficient mapping lookups
CategorySchema.index({ "marketplaceMappings.marketplaceId": 1, "marketplaceMappings.externalId": 1 });
