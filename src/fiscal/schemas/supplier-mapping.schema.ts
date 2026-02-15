import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierMappingDocument = HydratedDocument<SupplierMappingModel>;

@Schema({ collection: 'supplier_mappings', timestamps: true })
export class SupplierMappingModel {
    @Prop({ required: true, index: true })
    supplierCnpj: string;

    @Prop({ required: true })
    supplierCode: string;

    @Prop({ required: true })
    supplierName: string; // Helper for UI

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ default: 1 })
    conversionFactor: number; // e.g. Supplier sells box of 10 -> Factor 10
}

export const SupplierMappingSchema = SchemaFactory.createForClass(SupplierMappingModel);

// Compound index to ensure unique mapping per supplier product
SupplierMappingSchema.index({ supplierCnpj: 1, supplierCode: 1 }, { unique: true });
