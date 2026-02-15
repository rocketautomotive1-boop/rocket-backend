import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductModel } from './product.schema';

export type ProductCompatibilityDocument = HydratedDocument<ProductCompatibilityModel>;

@Schema({ collection: 'product_compatibilities', timestamps: true })
export class ProductCompatibilityModel {
    id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    product: ProductModel;

    @Prop({ index: true })
    productId: number;

    @Prop({ required: true, index: true })
    vehicleId: string;

    @Prop()
    vehicleName: string;

    @Prop()
    vehicleBrand: string;

    @Prop()
    vehicleModel: string;

    @Prop()
    vehicleYear: string;

    @Prop()
    vehicleVersion: string;

    @Prop()
    vehicleEngine: string;

    @Prop()
    vehicleFuelType: string;

    @Prop()
    vehicleTransmission: string;

    @Prop({ default: false })
    syncedWithMarketplace: boolean;


}

export const ProductCompatibilitySchema = SchemaFactory.createForClass(ProductCompatibilityModel);

// Compound index for fast lookup of a specific vehicle for a product
ProductCompatibilitySchema.index({ productId: 1, vehicleId: 1 });
ProductCompatibilitySchema.index({ product: 1, vehicleId: 1 });
