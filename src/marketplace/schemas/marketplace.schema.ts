import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MarketplaceDocument = HydratedDocument<MarketplaceModel>;

@Schema()
class MarketplaceTokenSnapshot {
    @Prop() accessToken: string;
    @Prop() refreshToken: string;
    @Prop() expiresAt: Date;
    @Prop() tokenType: string;
    @Prop({ type: Object }) additionalData: any;
    @Prop({ default: true }) isActive: boolean;
}

@Schema()
export class MarketplaceRequirementSnapshot {
    @Prop() fieldName: string; // The field name expected by the Marketplace API
    @Prop() schemaField: string; // The corresponding field path in the Product Schema (e.g., 'name', 'dimensions.height')
    @Prop() displayName: string;
    @Prop() description: string;
    @Prop({ default: false }) isRequired: boolean;
    @Prop() dataType: string;
    @Prop({ type: Object }) validationRules: any;
    @Prop({ type: Object }) options: any;
    @Prop({ default: 0 }) displayOrder: number;
}

@Schema()
export class MarketplaceDescriptionTemplateSnapshot {
    @Prop({ required: true, length: 100 })
    name: string;

    @Prop({ required: true, length: 255 })
    title: string;

    @Prop({ required: true, type: String })
    template: string;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ default: false })
    isDefault: boolean;

    @Prop({ type: Object, nullable: true })
    placeholders: Record<string, any>;

    @Prop({ type: [Object], nullable: true })
    sections: Record<string, any>[];
}

@Schema({ collection: 'marketplaces', timestamps: true })
export class MarketplaceModel {
    @Prop({ required: true, unique: true })
    name: string;

    @Prop({ unique: true, sparse: true })
    tag: string;

    @Prop({ default: true })
    enabled: boolean;

    @Prop()
    logoUrl: string;

    @Prop()
    description: string;

    @Prop({ type: Object })
    settings: any;

    @Prop({ type: [SchemaFactory.createForClass(MarketplaceTokenSnapshot)] })
    tokens: MarketplaceTokenSnapshot[];

    @Prop({ type: [SchemaFactory.createForClass(MarketplaceRequirementSnapshot)] })
    requirements: MarketplaceRequirementSnapshot[];

    @Prop({ type: [SchemaFactory.createForClass(MarketplaceDescriptionTemplateSnapshot)] })
    templates: MarketplaceDescriptionTemplateSnapshot[];

    @Prop()
    lockUntil: Date;
}

export const MarketplaceSchema = SchemaFactory.createForClass(MarketplaceModel);

// Add virtual 'id' that returns _id as string for frontend compatibility
MarketplaceSchema.virtual('id').get(function () {
    return this._id.toString();
});

// Ensure virtuals are included when converting to JSON
MarketplaceSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        (ret as any).id = ret._id.toString();

        return ret;
    }
});
