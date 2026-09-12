import { VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';

/**
 * Regras de precedência por SEÇÃO do documento — não por fonte global. Cada
 * fonte é boa em coisas diferentes: FIPE não erra o código fiscal, o ML não
 * erra a categoria de anúncio, o OEM não erra a ficha de engenharia, e
 * curadoria manual corrige qualquer um dos três. Ver docs do schema v2
 * (Denza B5 case study) para o raciocínio completo por seção.
 *
 * Índice mais alto = prioridade maior. 'manual' sempre aparece por último em
 * toda lista — é a única exceção universal, e já existia como tal no v1
 * (ver comentário histórico em upsertByCanonicalKey).
 */
const SECTION_PRIORITY: Record<string, VehicleOrigin[]> = {
  core: [VehicleOrigin.ML_IMPORT, VehicleOrigin.FIPE_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  powertrain: [VehicleOrigin.ML_IMPORT, VehicleOrigin.FIPE_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  chassisAndDynamics: [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  safetyAndAdas: [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  equipment: [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  warranty: [VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  colors: [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.MANUAL],
  fipe: [VehicleOrigin.ML_IMPORT, VehicleOrigin.FIPE_IMPORT, VehicleOrigin.MANUAL],
  years: [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.FIPE_IMPORT, VehicleOrigin.MANUAL],
};

export interface SectionState<T> {
  value: T | undefined;
  provenance: { sourceType: VehicleOrigin | string; fetchedAt: Date; confidence?: string; sourceId?: string } | undefined;
}

/** true se o valor é "ausente" para fins de merge — objeto vazio conta como ausente,
 *  igual a null/undefined, para não deixar uma seção parcialmente vazia vencer
 *  uma seção completa de fonte com prioridade menor. */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/**
 * Decide se `incoming` deve sobrescrever `existing` para uma seção nomeada.
 *
 * Regra: a fonte de MAIOR prioridade que tem valor não-vazio vence — não é
 * "o dado mais recente vence". Se o incoming é de fonte >= prioridade da atual
 * MAS o valor está vazio (ex: OEM não informou transmission porque o carro é
 * elétrico), a seção existente é preservada em vez de apagada.
 */
export function shouldReplaceSection(
  sectionName: keyof typeof SECTION_PRIORITY,
  existing: SectionState<unknown>,
  incoming: SectionState<unknown>,
): boolean {
  if (isEmptyValue(incoming.value)) return false;
  if (isEmptyValue(existing.value)) return true;

  const priority = SECTION_PRIORITY[sectionName] ?? [VehicleOrigin.ML_IMPORT, VehicleOrigin.OEM_IMPORT, VehicleOrigin.FIPE_IMPORT, VehicleOrigin.MANUAL];
  const existingRank = priority.indexOf(existing.provenance?.sourceType as VehicleOrigin);
  const incomingRank = priority.indexOf(incoming.provenance?.sourceType as VehicleOrigin);

  // Fonte desconhecida (não cadastrada na lista de prioridade) nunca sobrescreve
  // uma fonte conhecida — mais seguro do que assumir prioridade 0 silenciosamente.
  if (incomingRank === -1) return existingRank === -1;

  return incomingRank >= existingRank;
}

export const SECTION_NAMES = Object.keys(SECTION_PRIORITY) as Array<keyof typeof SECTION_PRIORITY>;
