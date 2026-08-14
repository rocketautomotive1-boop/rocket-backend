// Re-export schema models and documents
export { ProductModel, ProductDocument, ProductImage, ProductTitle, ProductAttribute } from './schemas/product.schema';
export { StockMovementModel, StockMovementDocument } from '../stock/schemas/stock-movement.schema';
export { ProductCompatibilityModel, ProductCompatibilityDocument } from './schemas/product-compatibility.schema';
export { ProductNCMModel, ProductNCMDocument } from './schemas/product-ncm.schema';
export { ProductUnitModel, ProductUnitDocument } from './schemas/product-unit.schema';
export { ProductWarrantyModel, ProductWarrantyDocument } from './schemas/product-warranty.schema';
export { ProductConditionModel, ProductConditionDocument } from './schemas/product-condition.schema';
export { ProductPublicationLogModel, ProductPublicationLogDocument, PublicationStatus } from './schemas/product-publication-log.schema';
export { CategoryModel, CategoryDocument } from './schemas/category.schema';

// Type aliases for embedded snapshots (these don't exist as separate collections)
export type ProductBrand = {
    id: number | string;
    _id?: string;
    name: string;
    logoUrl?: string; // Opt
    isGenuine: boolean;
    shortName?: string;
    amazonName?: string;
    fullName?: string;
    externalId?: string;
};

export type ProductCategory = {
    id: number | string;
    _id?: string;
    name: string;
    parentId?: number | string;
    externalId?: string;
};

export type ProductUnit = {
    id: number;
    code: string;
    name: string;
};

export { ProductDraftModel, ProductDraftDocument } from './schemas/product-draft.schema';

// Placeholder types for entities not yet migrated to MongoDB
export type ProductAllocation = any;
export type BoxItem = any;
export type ProductMovement = any;
