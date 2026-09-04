import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, HydratedDocument, SchemaTypes } from 'mongoose';
import { Transform } from 'class-transformer';
import { normalizeCode } from '../utils/code-key.util';

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
export class ProductCatalogApplication {
    // Vehicle make as printed in the source catalog (e.g. "FIAT") — raw, not yet
    // resolved against vehicle_compatibilities. Matching to a real vehicleId is a
    // separate step; see docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md.
    @Prop() fabricante: string;
    @Prop() modelo: string;
    @Prop() complemento?: string;
    // Free-text year range/version as printed (e.g. "1998...2008"), not parsed into numbers.
    @Prop() periodo?: string;
    @Prop() motorizacao?: string;
    // Where on the vehicle the part mounts, as printed (e.g. Schaeffler's
    // "DIANTEIRO - EXTERIOR"). Not every catalog provides this.
    @Prop() posicaoMontagem?: string;
}

@Schema()
class ProductCatalogKitComponent {
    // partNumber of a component product sold separately (e.g. Schaeffler's
    // CONJ_PRODS: a RepSet clutch kit lists the disc, pressure plate, and
    // release bearing as its components). Raw partNumber, not resolved to an
    // ObjectId — same rationale as catalogSimilarCodes.
    @Prop() partNumber: string;
    @Prop() quantidade?: number;
}

@Schema()
class ProductCatalogAttribute {
    // Stable source column (e.g. "CpoAuxProd2") — the source catalog's own UI
    // labels these dynamically per product type (e.g. Schaeffler shows
    // CpoAuxProd2 as "Diâmetro do Disco (mm)" for clutch discs but something
    // else for other product families), and there's no fixed column->label
    // table in the database. `name` carries a human label when one is known,
    // otherwise falls back to `code` — see the catalog's own parser.ts for
    // whichever labels have been identified so far.
    @Prop() code: string;
    @Prop() name: string;
    @Prop() value: string;
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

    // Quem cadastrou o produto. Legado: não participa mais da resolução de
    // loja/conta de publicação — essa resolução usa Listing.storeId (ver
    // InternalProductController.getListings). Mantido só como metadado
    // histórico (0,01% dos produtos em produção o têm preenchido).
    @Prop({ type: SchemaTypes.ObjectId, required: false })
    createdByUserId?: Types.ObjectId;

    // Título curto reutilizável entre produtos (ex: "Parafuso"), com sinônimos
    // próprios — ver ProductShortTitleModel e
    // docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
    // Substitui o antigo `displayName` (string solta, não reutilizável).
    @Prop({ type: SchemaTypes.ObjectId, ref: 'ProductShortTitleModel', index: true })
    titleId?: Types.ObjectId;

    // Especialização do title, texto livre por produto, sem sinônimo próprio
    // (ex: "Dianteiro do Virabrequim"). Editável na tela de Categoria.
    @Prop({ type: String, required: false })
    subtitle?: string;

    // Denormalizado de ProductShortTitleModel.text/synonyms (espelhado no save
    // e via updateMany no fan-out de ProductShortTitleService.addSynonym) —
    // evita $lookup no caminho de busca do Atlas Search.
    @Prop({ type: String })
    titleText?: string;

    @Prop({ type: [String], index: true })
    titleSynonyms?: string[];

    // Opcional: autopeças sempre preenchem; itens gerais (domain:'general') usam
    // `barcode` como identidade. unique+sparse permite ausência sem colidir.
    @Prop({ index: true, unique: true, sparse: true })
    partNumber: string;

    // Chave normalizada de partNumber (ver code-key.util normalizeCode), usada
    // em toda busca/match por código — não exposta para edição direta, apenas
    // derivada de `partNumber` no pre-save hook. Unicidade é composta com
    // brand._id (ver índice abaixo): marcas diferentes podem legitimamente
    // compartilhar o mesmo código-base (ex: rolamentos com designação DIN/ISO
    // padronizada, vendidos por FAG e SKF sob o mesmo código regionalizado).
    @Prop({ index: true })
    partNumberKey: string;

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

    @Prop({ type: Types.ObjectId, ref: 'CrossReferenceGroupModel', index: true })
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
    oemCodes: string[]; // Denormalized Cache for Search (raw codes, for display)

    // Normalized counterpart of oemCodes (ver code-key.util normalizeCode) — this is
    // what search actually queries against; oemCodes stays raw for display/auditing.
    @Prop({ type: [String], index: true })
    oemCodesKeys: string[];

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

    // Free-text notes from the source catalog (e.g. Cofap's PRODUTO_OBS — "also
    // available as SPA version, code SGP32477").
    @Prop({ type: String })
    catalogObservacao?: string;

    // Source catalog's own "novidade"/promo/clearance flags and their validity
    // window, as printed (e.g. Cofap's FlagLancamento + DataFlagLancamento/
    // ValidFlagLancamento). Informational only — does not drive Rocket's own
    // promotion/pricing logic.
    @Prop({ type: Boolean })
    catalogLancamento?: boolean;

    @Prop({ type: Date })
    catalogLancamentoData?: Date;

    @Prop({ type: Date })
    catalogLancamentoValidade?: Date;

    @Prop({ type: Boolean })
    catalogPromocao?: boolean;

    @Prop({ type: Date })
    catalogPromocaoData?: Date;

    @Prop({ type: Date })
    catalogPromocaoValidade?: Date;

    @Prop({ type: Boolean })
    catalogPontaEstoque?: boolean;

    // Cofap's "cor de identificação" — paint-color coding printed on gas-spring
    // parts to distinguish variants at a glance (e.g. "1 AZUL + 1 OU 2 BRANCAS").
    // Free text, only meaningful for that product family.
    @Prop({ type: String })
    catalogCorIdentificacao?: string;

    // Absolute paths to extra reference photos from the source catalog install
    // (beyond `arquivoImagem`/the main product image). These are catalog
    // reference images, not marketplace listing photos — kept separate from
    // `images`, which is the curated set actually published to marketplaces.
    @Prop({ type: [String] })
    catalogImagensExtras?: string[];

    // Raw per-vehicle application rows from the source catalog (e.g. Cofap's
    // PRODUTO_APLICACAO/APLICACAO join) — one entry per make+model+period the
    // catalog lists. NOT resolved against vehicle_compatibilities yet; feeds a
    // separate matching step that creates real product_compatibilities records.
    @Prop({ type: [SchemaFactory.createForClass(ProductCatalogApplication)] })
    catalogApplications?: ProductCatalogApplication[];

    // partNumbers of OTHER products in the SAME source catalog that it lists as
    // "similar" (e.g. Delphi's SIMILAR table — often an obsolete product
    // pointing at its replacement, not necessarily an interchangeable part).
    // Raw partNumber references, not resolved to ObjectIds — the target
    // product may not exist yet at import time, and re-resolving by
    // partNumber on read keeps this from going stale if a product is re-imported.
    @Prop({ type: [String] })
    catalogSimilarCodes?: string[];

    // partNumbers of OTHER products in the SAME catalog that share at least
    // one vehicle application with this product (e.g. Schaeffler's "Relacionados
    // à Aplicação" — an inner + outer clutch disc that both fit the same
    // vehicle/engine). Different from catalogSimilarCodes: these are DISTINCT,
    // complementary parts for the same fitment, not obsolete/replacement pairs.
    // Computed by the source-catalog parser (products sharing a CodigoAplicacao),
    // not a table in the source database itself. Raw partNumbers, same
    // resolve-on-read rationale as catalogSimilarCodes.
    @Prop({ type: [String] })
    catalogRelatedByApplication?: string[];

    // Country of manufacture, as printed by the source catalog (e.g. "Brasil",
    // "China" — Schaeffler's CpoAuxProd33). Distinct from tax.origin (the NF
    // ICMS-origin code, e.g. "0"/"1"/"2") — this is plain-text, catalog-provided
    // provenance, not derived from any fiscal document.
    @Prop({ type: String })
    catalogPaisOrigem?: string;

    // Free-text lifecycle status as printed by the source catalog (e.g.
    // Schaeffler's "Ativo"/"Descontinuado", CpoAuxProd39) — informational only,
    // does NOT drive Rocket's own `active` flag.
    @Prop({ type: String })
    catalogEstadoMaterial?: string;

    // Raw per-product-type technical spec fields the source catalog exposes
    // (e.g. Schaeffler's "Diâmetro do Disco", "Número de Estrias", "Amortecedor
    // do Disco") that have no fixed meaning across the whole catalog — unlike
    // the named catalog* fields above (which ARE stable catalog-wide), these
    // vary by product family, so they're kept as raw code/value pairs instead
    // of dedicated schema fields. See ProductCatalogAttribute.
    @Prop({ type: [SchemaFactory.createForClass(ProductCatalogAttribute)] })
    catalogAttributes?: ProductCatalogAttribute[];

    // Component products that make up THIS product when it's a kit/set (e.g.
    // Schaeffler's CONJ_PRODS — a "RepSet" clutch kit composed of separately
    // sold disc/plate/bearing products). Empty for non-kit products.
    @Prop({ type: [SchemaFactory.createForClass(ProductCatalogKitComponent)] })
    catalogKitComponents?: ProductCatalogKitComponent[];

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

    /**
     * Exclusão completa em cascata (admin-only, ver ProductDeletionService). Ausente = normal.
     * 'pending': aguardando confirmação assíncrona de remoção de 1+ Listing publicado no
     * marketplace (via fila do orchestrator). 'failed': algum marketplace não confirmou a
     * remoção — admin pode tentar de novo.
     */
    @Prop({ type: String, enum: ['pending', 'failed'] })
    deletionStatus?: 'pending' | 'failed';

    @Prop({ type: Date })
    deletionRequestedAt?: Date;

    @Prop({ type: SchemaTypes.ObjectId })
    deletionRequestedBy?: Types.ObjectId;

    /** Listings publicados ainda aguardando confirmação de remoção via fila. */
    @Prop({ type: [SchemaTypes.ObjectId], default: undefined })
    deletionPendingListingIds?: Types.ObjectId[];

    @Prop({ type: String })
    deletionFailureReason?: string;
}

export const ProductSchema = SchemaFactory.createForClass(ProductModel);

// Unicidade de partNumberKey é por marca, não global — ver comentário do @Prop
// acima. sparse: produtos sem partNumberKey (ex: domain:'general') não colidem.
ProductSchema.index({ 'brand._id': 1, partNumberKey: 1 }, { unique: true, sparse: true });

// Keeps partNumberKey/oemCodesKeys in sync with their raw counterparts on every
// .save() (create/update paths use Mongoose documents). Bulk writes (e.g.
// import-catalog's bulkWrite) bypass this hook and compute the keys explicitly.
ProductSchema.pre('save', function (this: ProductDocument) {
    if (this.isModified('partNumber')) {
        this.partNumberKey = this.partNumber ? normalizeCode(this.partNumber) : undefined;
    }
    if (this.isModified('oemCodes')) {
        this.oemCodesKeys = (this.oemCodes || []).map((c) => normalizeCode(c));
    }
});

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

// active stopped being a highly selective filter after the July 2026 catalog
// backfill (~147k products flipped active:false -> active:true — see
// activateAllInactiveProducts). Queries that filter ONLY on active and sort
// by a field with no supporting index fell back to in-memory sort over the
// full active set. These cover that: best-sellers rail (active + relevanceScore,
// without depending on isUniversalFit like the compound index above), and
// findForStore/searchByBarcodeOrName's createdAt/updatedAt sorts.
ProductSchema.index({ active: 1, relevanceScore: -1 });
ProductSchema.index({ active: 1, createdAt: -1 });
ProductSchema.index({ active: 1, updatedAt: -1 });

