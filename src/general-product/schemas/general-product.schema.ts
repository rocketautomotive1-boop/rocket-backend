// backend/src/general-product/schemas/general-product.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Transform } from 'class-transformer';

export type GeneralProductDocument = HydratedDocument<GeneralProductModel>;

@Schema({ _id: false })
export class GeneralProductImage {
  @Prop() url: string;
  @Prop() main: boolean;
  @Prop() order: number;
  @Prop() status: string;
}

@Schema({ _id: false })
export class GeneralProductBrand {
  @Prop() name: string;
  @Prop() logoUrl: string;
  @Prop() externalId: string;
}

@Schema({ _id: false })
export class GeneralProductTax {
  @Prop() ncm: string;
  @Prop() cest: string;
  @Prop() origin: string;
}

@Schema({ _id: false })
export class PerishableInfo {
  @Prop({ default: false }) isPerishable: boolean;
  @Prop() shelfLifeDays?: number;
  @Prop() expiryDate?: Date;
  @Prop() batch?: string;
}

export type RegulatoryAgency = 'ANVISA' | 'MAPA' | 'OTHER';

@Schema({ _id: false })
export class RegulatoryRegistration {
  @Prop({ enum: ['ANVISA', 'MAPA', 'OTHER'] }) agency: RegulatoryAgency;
  @Prop() number: string;
}

@Schema({ _id: false })
export class NutritionalInfo {
  @Prop() servingSize: string;
  @Prop() calories?: number;
  @Prop({ type: Object }) values?: Record<string, number | string>;
}

@Schema({ _id: false })
export class Composition {
  @Prop({ type: [String], default: [] }) ingredients: string[];
  @Prop() warnings?: string;
}

@Schema({ _id: false })
export class ProductSpecifications {
  @Prop({ type: NutritionalInfo }) nutritionalInfo?: NutritionalInfo;
  @Prop({ type: Composition }) composition?: Composition;
}

@Schema({ collection: 'general_products', timestamps: true })
export class GeneralProductModel {
  _id: string;

  @Prop({ required: true, unique: true, index: true })
  barcode: string;

  @Prop({ required: true, index: true })
  name: string;

  @Prop({ unique: true, sparse: true })
  slug: string;

  @Prop()
  description: string;

  @Prop({ type: GeneralProductBrand })
  brand: GeneralProductBrand;

  @Prop({ type: Types.ObjectId, ref: 'GeneralCategoryModel', index: true })
  category: Types.ObjectId;

  @Prop({ type: [SchemaFactory.createForClass(GeneralProductImage)], default: [] })
  images: GeneralProductImage[];

  @Prop({ default: true, index: true })
  active: boolean;

  @Prop({ type: Types.Decimal128 })
  @Transform(({ value }) => value?.toString())
  price: Types.Decimal128;

  @Prop({ type: Types.Decimal128 })
  @Transform(({ value }) => value?.toString())
  costPrice: Types.Decimal128;

  @Prop({ type: Types.Decimal128 })
  @Transform(({ value }) => value?.toString())
  listPrice: Types.Decimal128;

  @Prop({ type: Types.Decimal128 })
  @Transform(({ value }) => value?.toString())
  weight: Types.Decimal128;

  @Prop({
    type: { length: Types.Decimal128, width: Types.Decimal128, height: Types.Decimal128 },
    _id: false,
  })
  dimensions: { length: Types.Decimal128; width: Types.Decimal128; height: Types.Decimal128 };

  @Prop({ required: true })
  ncm: string;

  @Prop({ type: GeneralProductTax })
  tax: GeneralProductTax;

  @Prop({ type: PerishableInfo, default: {} })
  perishable: PerishableInfo;

  @Prop({ type: RegulatoryRegistration })
  regulatoryRegistration: RegulatoryRegistration;

  @Prop({ type: ProductSpecifications, default: {} })
  specifications: ProductSpecifications;

  @Prop({ default: 'general', enum: ['general'] })
  domain: string;
}

export const GeneralProductSchema = SchemaFactory.createForClass(GeneralProductModel);

GeneralProductSchema.set('toJSON', { virtuals: true });
GeneralProductSchema.set('toObject', { virtuals: true });
