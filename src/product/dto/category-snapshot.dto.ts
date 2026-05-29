export interface MlAttributePayloadDto {
  id: string;
  name: string;
  value: string;
  valueName?: string;
  valueType?: string;
}

export interface HydratedCategoryDto {
  id: string;
  name: string;
  breadcrumbs: string;
  marketplaceMappings?: any[];
  raw: any;
}

export interface MlSnapshotStateDto {
  externalCategoryId: string;
  schema: { required: any[]; optional: any[] };
  hydratedValues: Record<string, string>;
  missing: string[];
  attributesPayload: MlAttributePayloadDto[];
  serverAttrsAlreadySaved: boolean;
}

export interface CategorySnapshotDto {
  productId: string;
  product: any;
  internalCategory: HydratedCategoryDto | null;
  discovery: {
    resolvedCategoryId: string | null;
    resolvedCategory: HydratedCategoryDto | null;
  };
  ml: MlSnapshotStateDto | null;
}
