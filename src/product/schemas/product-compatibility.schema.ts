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
    productId: string;

    /** _id do vehicle_compatibilities correspondente (base própria). */
    @Prop({ required: true, index: true })
    vehicleId: string;

    /** Id da taxonomia de catálogo do Mercado Livre — necessário para sync de volta ao ML. */
    @Prop({ index: true })
    mlVehicleId: string;

    @Prop()
    vehicleName: string;

    @Prop({ default: false })
    syncedWithMarketplace: boolean;

    /** true quando a migração de dados legados não encontrou match em vehicle_compatibilities. */
    @Prop({ default: false })
    needsReview: boolean;

    /** catalog_product_id de PEÇA do ML (não o de veículo) resolvido para esta linha. */
    @Prop()
    mlCatalogProductId?: string;

    /** value_id do atributo POSITION do ML (ex: "13701105"), quando o domínio o define. */
    @Prop()
    position?: string;

    /** value_name do atributo POSITION (ex: "Traseira"), para exibição sem round-trip. */
    @Prop()
    positionName?: string;

    /** value_id do atributo SIDE_POSITION do ML (ex: "364128"). */
    @Prop()
    sidePosition?: string;

    /** value_name do atributo SIDE_POSITION (ex: "Esquerdo"). */
    @Prop()
    sidePositionName?: string;

    /**
     * true quando a resolução automática de mlCatalogProductId não encontrou match
     * exato único (0 ou 2+ candidatos com mesmo PART_NUMBER) — precisa de revisão
     * manual antes de confiar na posição. Mesma semântica de `needsReview`.
     */
    @Prop({ default: false })
    positionNeedsReview: boolean;

    /**
     * Texto de busca combinado (nome/oemCodes/EQUIVALENT_OEM do produto + marca/modelo/versão/
     * ano/aliases do veículo vinculado). Alimenta a busca única "palheta toro 2025" sem parsing
     * determinístico — ver docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md.
     */
    @Prop({ index: true })
    searchText?: string;
}

export const ProductCompatibilitySchema = SchemaFactory.createForClass(ProductCompatibilityModel);

// Compound index for fast lookup of a specific vehicle for a product
ProductCompatibilitySchema.index({ productId: 1, vehicleId: 1 });
ProductCompatibilitySchema.index({ product: 1, vehicleId: 1 });
// Reverse lookup: dado um veículo, encontrar produtos compatíveis.
ProductCompatibilitySchema.index({ vehicleId: 1, productId: 1 });
