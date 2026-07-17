import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, HydratedDocument, SchemaTypes } from 'mongoose';
import { Transform } from 'class-transformer';

export type ProductDocument = HydratedDocument<ProductModel>;


@Schema()
export class ProductImage {
    /** Stable identity of the list slot. Survives reorder; used to reconcile async
     *  rembg results back into the exact slot the user placed. */
    @Prop({ index: true }) slotId: string;
    @Prop() url: string;
    @Prop() key: string;
    @Prop() mimeType: string;
    @Prop() main: boolean;
    @Prop() originalName: string;
    /** Position in the list = source of truth for ordering. */
    @Prop() order: number;
    /** 'active' | 'processing' | 'failed'. A reserved rembg slot is 'processing'. */
    @Prop() status: string;
}

@Schema()
export class ProductTitle {
    @Prop({ type: Types.ObjectId }) marketplaceId: Types.ObjectId;
    @Prop() title: string;
    // Extended
    @Prop() locale: string;
    @Prop() externalId?: string;
    @Prop() syncStatus?: string;
    @Prop() lastSyncAt?: Date;
    @Prop({ type: Object }) marketplaceData?: any;
}

@Schema()
export class ProductAttribute {
    @Prop() name: string;
    @Prop() value: string;
    @Prop() valueName?: string; // Human readable value for lists
    @Prop() valueType?: string; // list, string, number_unit, etc
    @Prop() code: string;
    @Prop({ type: Types.ObjectId }) marketplaceId: Types.ObjectId;
}



@Schema()
class ProductBrandSnapshot {
    @Prop() _id?: string;
    @Prop() name: string;
    @Prop() logoUrl: string;
    @Prop() isGenuine: boolean;
    // Extended
    @Prop() shortName: string;
    @Prop() amazonName: string;
    @Prop() fullName: string;
    @Prop() externalId: string;
}

@Schema()
class ProductCategorySnapshot {
    @Prop() _id?: string;
    @Prop() name: string;
    @Prop() parentId?: number;
    @Prop() externalId: string;
}

@Schema()
class ProductUnitSnapshot {
    @Prop() _id?: string;
    @Prop() code: string;
    @Prop() name: string;
}

@Schema()
class ProductAllocationSnapshot {
    @Prop() _id?: string;
    @Prop() code: string;
    @Prop() quantity: number;
    @Prop() type: string;
    // New fields
    @Prop({ type: Types.ObjectId }) boxId: Types.ObjectId;
    @Prop() boxCode: string;
    // Extended fields
    @Prop({ type: Types.ObjectId }) warehouseId: Types.ObjectId;
    @Prop() floor: number;
    @Prop() room: number;
    @Prop() row: string;
    @Prop() level: number;
    @Prop() rack: string;
    @Prop() shelf: number;
    @Prop() bin: number;
    @Prop() aisle: number;
}



export type ProductWarningType = 'WRONG_CATEGORY' | 'MISSING_COMPATIBILITIES';

@Schema({ _id: false })
export class ProductWarning {
    @Prop({ required: true })
    type: ProductWarningType;

    @Prop({ required: true })
    message: string;

    @Prop({ required: true })
    marketplaceTag: string;

    @Prop()
    externalId?: string;

    @Prop()
    originalCategoryId?: string;

    @Prop({ type: [String], default: [] })
    suggestedCategoryIds?: string[];

    @Prop({ required: true })
    createdAt: Date;
}

@Schema()
export class ProductTax {
    @Prop() ncm: string;
    @Prop() cfop: string;
    @Prop() csosn: string;
    @Prop() cest: string;
    @Prop() origin: string;
}

@Schema({ collection: 'products', timestamps: true })
export class ProductModel {
    _id: string;

    @Prop({ default: 1 })
    schemaVersion: number;

    @Prop({ required: true, index: true })
    name: string;

    // Nome curto/resumido (ex: "Disco de Embreagem"), separado do `name` completo
    // usado para SEO/marketplace. Editável na tela de Categoria; ver
    // docs/superpowers/specs/2026-07-13-product-display-name-category-hint-design.md.
    @Prop({ type: String, required: false })
    displayName?: string;

    // Opcional: autopeças sempre preenchem; itens gerais (domain:'general') usam
    // `barcode` como identidade. unique+sparse permite ausência sem colidir.
    @Prop({ index: true, unique: true, sparse: true })
    partNumber: string;

    // unique + sparse: autopeças geram slug; itens gerais (domain:'general') podem
    // não ter slug — sparse evita colisão de múltiplos null no índice unique.
    @Prop({ unique: true, sparse: true })
    slug: string;

    // Sem índice no @Prop: autopeças têm barcodes duplicados no histórico, então
    // barcode NÃO é unique global. A unicidade (e o índice) do barcode para itens
    // gerais (domain:'general') é criada como índice PARCIAL pela migração
    // scripts/migrate-product-sparse-indexes.ts. Definir index aqui recriaria um
    // barcode_1 conflitante no boot.
    @Prop()
    barcode: string;

    @Prop()
    isGenuine: boolean;

    @Prop()
    description: string;

    @Prop()
    details: string; // Additional technical details/specs

    // Tax Data
    @Prop({ type: ProductTax })
    tax: ProductTax;

    // Sale price (basePrice + per-marketplace overrides + listPrice/markup meta) lives in
    // PricingModule (product_pricing). Read via PRICING_PORT; cost lives on the StockLot.

    @Prop({ type: Object })
    lastPurchase: {
        date: Date;
        supplierCnpj: string;
        supplierName: string;
        costPrice: number; // Unit Cost from NF
        freightCost: number; // Rateio Frete
        otherExpenses: number; // Rateio Despesas
        // taxDetails: {
        //     ipi: number;
        //     icms: number;
        //     icmsSt: number;
        // };
        taxes: {
            icms: {
                cst: string;
                origin: string;
                base: number;
                rate: number;
                value: number;
                valueSt: number;
            };
            ipi: {
                cst: string;
                base: number;
                rate: number;
                value: number;
            };
            pis: {
                cst: string;
                base: number;
                rate: number;
                value: number;
            };
            cofins: {
                cst: string;
                base: number;
                rate: number;
                value: number;
            };
        };
        finalCost: number; // (Cost + IPI + ST + Freight + Others - Discounts)
    };


    // Dimensions & Weight
    @Prop({ type: Types.Decimal128 })
    @Transform(({ value }) => value?.toString())
    weight: Types.Decimal128;

    @Prop({
        type: {
            length: Types.Decimal128,
            width: Types.Decimal128,
            height: Types.Decimal128
        },
        _id: false
    })
    @Transform(({ value }) => {
        if (!value) return value;
        return {
            length: value.length?.toString(),
            width: value.width?.toString(),
            height: value.height?.toString()
        };
    })
    dimensions: {
        length: Types.Decimal128;
        width: Types.Decimal128;
        height: Types.Decimal128;
    };

    @Prop({ type: ProductBrandSnapshot })
    brand: ProductBrandSnapshot;

    @Prop({ type: SchemaTypes.ObjectId, ref: 'CategoryModel', index: true })
    category: Types.ObjectId;

    @Prop({ type: ProductUnitSnapshot })
    unit: ProductUnitSnapshot;

    @Prop({ type: [SchemaFactory.createForClass(ProductImage)] })
    images: ProductImage[];

    @Prop({ type: [SchemaFactory.createForClass(ProductAttribute)] })
    attributes: ProductAttribute[];

    // Warehouse Data
    @Prop({ type: [SchemaFactory.createForClass(ProductAllocationSnapshot)] })
    allocations: ProductAllocationSnapshot[];

    @Prop({ default: true, index: true })
    active: boolean;

    // stockReserved removed — reservations live in StockBalance.reserved (StockModule).

    @Prop({ type: Types.ObjectId, ref: 'CrossReferenceGroupModel' })
    crossReferenceGroupId: Types.ObjectId;

    @Prop({ default: 0 })
    totalSold: number;

    // Review Aggregation
    @Prop({ default: 0, index: true })
    ratingAverage: number;

    @Prop({ default: 0 })
    ratingCount: number;

    // --- SEO & Technical Fields ---
    @Prop({ default: 'new', enum: ['new', 'used', 'remanufactured'] })
    condition: string;

    @Prop({ type: Object })
    warranty: {
        months: number;
        type: string; // e.g., 'provider', 'manufacturer'
    };

    @Prop({ type: [String], index: true })
    oemCodes: string[]; // Denormalized Cache for Search

    @Prop({ type: [String], index: true })
    applicationSummary: string[]; // SEO Keywords: "Civic 2008", "Corolla 2010"

    // Proveniência de import via tools/catalog-extractor (dump de catálogos desktop
    // legados). `codigoOrigemCatalogo` é o código do fabricante no catálogo de origem —
    // não confundir com `partNumber` (que é setado igual a ele na importação).
    @Prop({ type: String })
    origemCatalogo?: string;

    @Prop({ type: String, index: true })
    codigoOrigemCatalogo?: string;

    @Prop({ type: String })
    catalogTipoProduto?: string;

    @Prop({ type: String })
    catalogPosicao?: string;

    @Prop({ type: String })
    catalogMotorizacao?: string;

    /**
     * Resumo denormalizado de product_compatibilities — só para listagem/exibição rápida sem
     * buscar a lista completa de vínculos. Fonte de verdade continua em product_compatibilities;
     * ver docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md.
     */
    @Prop({ type: Object })
    compatibilitySummary?: {
        makes: string[];
        models: string[];
        vehicleCount: number;
        updatedAt: Date;
    };

    /** Peça universal: aparece em qualquer busca por veículo sem vínculo em product_compatibilities. */
    @Prop({ default: false, index: true })
    isUniversalFit?: boolean;

    /**
     * Score de relevância para ordenação dos rails da home (universal/best-sellers/for-your-car/
     * accessories-for-your-car), recalculado periodicamente por RelevanceScoreJob a partir de
     * totalSold/ratingAverage/ratingCount e do priorityWeight da categoria — ver
     * docs/superpowers/specs/2026-07-13-product-relevance-rails-design.md.
     */
    @Prop({ default: 0, index: true })
    relevanceScore: number;

    @Prop({ type: Object })
    draftData: any; // Data from AI Drafts or NFe Imports

    @Prop({ type: Boolean, default: false })
    readyToPublish: boolean;

    @Prop({
      type: {
        data: { type: Boolean, default: false },
        images: { type: Boolean, default: false },
        titles: { type: Boolean, default: false },
        category: { type: Boolean, default: false },
        inventory: { type: Boolean, default: false },
        dimensions: { type: Boolean, default: false },
        readyToPublish: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
      },
      default: {},
    })
    completion: {
      data: boolean;
      images: boolean;
      titles: boolean;
      category: boolean;
      inventory: boolean;
      dimensions: boolean;
      readyToPublish: boolean;
      completedAt: Date | null;
    };

    @Prop({ type: [SchemaFactory.createForClass(ProductWarning)], default: [] })
    warnings: ProductWarning[];

    /** Origem do produto. 'autopecas' (default) ou 'general' (projetado de general_products). */
    @Prop({ default: 'autopecas', index: true })
    domain: string;
}

export const ProductSchema = SchemaFactory.createForClass(ProductModel);

// Ensure Virtuals are included
ProductSchema.set('toJSON', { virtuals: true });
ProductSchema.set('toObject', { virtuals: true });

// Text Index
ProductSchema.index({ name: 'text' });

// Compound Indexes
ProductSchema.index({ active: 1, 'category': 1 });
ProductSchema.index({ partNumber: 1, 'brand.name': 1 });
ProductSchema.index({ active: 1, ratingAverage: -1 }); // Sorting by best rated active products
ProductSchema.index({ active: 1, isUniversalFit: 1, relevanceScore: -1 }); // Rails da home (universal/best-sellers)

