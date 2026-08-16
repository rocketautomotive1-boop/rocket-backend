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

/**
 * Diagnóstico da resolução ML da categoria interna — SEMPRE presente (mesmo quando
 * `ml` é null), para o fluxo centralizado (deriveNextAction) saber POR QUE não há
 * atributos e agir. `ready` = tem categoria ML folha publicável (ml preenchido).
 * `needs_leaf` = tem mapping ML mas é nó não-folha (precisa descer até a folha).
 * `unmapped` = categoria interna sem nenhum mapping ML. `no_category` = sem categoria.
 */
export interface MlResolutionDto {
  status: 'ready' | 'needs_leaf' | 'unmapped' | 'no_category';
  /** MLB do mapping atual (folha ou não), quando existe — usado para resolver a folha. */
  mlCategoryId: string | null;
}

export interface CategorySnapshotDto {
  productId: string;
  product: any;
  internalCategory: HydratedCategoryDto | null;
  ml: MlSnapshotStateDto | null;
  mlResolution: MlResolutionDto;
}

/**
 * Payload canônico de publicação ML — a MESMA hidratação que alimenta o snapshot
 * do app, exposta para o orchestrator publicar sem remontar atributos. Fonte única
 * de verdade dos atributos obrigatórios (PART_NUMBER/BRAND/GTIN/dimensões).
 */
export interface MlPublishPayloadDto {
  externalCategoryId: string;
  attributes: MlAttributePayloadDto[];
  /** Atributos obrigatórios ainda não preenchidos — publicação deve falhar fechada se houver. */
  missing: string[];
}
