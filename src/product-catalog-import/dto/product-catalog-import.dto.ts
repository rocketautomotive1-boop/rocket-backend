export interface CatalogImportCandidateDto {
  catalogProductId: string;
  name: string;
  domainId?: string;
  categoryId?: string;
  brandName?: string;
  thumbnail?: string;
}

export interface CatalogImportSearchResultDto {
  candidates: CatalogImportCandidateDto[];
}

export interface CatalogImportDraftAttributeDto {
  id: string;
  name: string;
  value: string;
}

export interface CatalogImportDraftPositionDto {
  position?: string;
  positionName?: string;
  sidePosition?: string;
  sidePositionName?: string;
}

export interface CatalogImportDraftDto {
  catalogProductId: string;
  name: string;
  brandName?: string;
  partNumber?: string;
  attributes: CatalogImportDraftAttributeDto[];
  images: string[];
  suggestedCategoryId?: string;
  position?: CatalogImportDraftPositionDto;
  vehicleIds: string[];
  vehiclesSkipped: number;
}

export interface ConfirmCatalogImportDto extends CatalogImportDraftDto {
  /** Quando presente, enriquece o produto existente em vez de criar um novo. */
  productId?: string;
  /** Necessário para criar produto novo — o rascunho não resolve brandId sozinho. */
  brandId?: string;
}
