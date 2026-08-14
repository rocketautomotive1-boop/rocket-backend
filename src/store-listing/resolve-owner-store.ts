import { Types } from 'mongoose';

export interface ResolveOwnerStoreParams {
  createdByUserId: Types.ObjectId | null | undefined;
  /** Looks up user.storeId given a userId string; returns null if the user or its storeId is absent. */
  userStoreIdLookup: (userId: string) => Promise<string | null>;
  fallbackStoreId: string;
}

/**
 * Resolve qual loja é dona de um produto/listing/lote de estoque:
 * createdByUserId -> user.storeId, com fallback explícito quando não há
 * sinal ou o sinal é inválido. Fallback é o caminho esperado para a
 * esmagadora maioria dos dados hoje (28/286506 produtos têm
 * createdByUserId) — não é um caso de erro.
 */
export async function resolveOwnerStore(params: ResolveOwnerStoreParams): Promise<string> {
  const { createdByUserId, userStoreIdLookup, fallbackStoreId } = params;
  if (!createdByUserId) return fallbackStoreId;

  const storeId = await userStoreIdLookup(String(createdByUserId));
  if (!storeId || !Types.ObjectId.isValid(storeId)) return fallbackStoreId;

  return storeId;
}

export interface ResolveOwnerStoreByListingParams {
  /** storeId(s) já gravado(s) nos ListingModel ativos do produto — sinal mais forte
   * que createdByUserId (confirmado 2026-08-14: 99,99% dos produtos não têm
   * createdByUserId, mas listings publicados já carregam storeId correto desde o
   * roteamento por operador). */
  listingStoreIds: (Types.ObjectId | string)[];
  createdByUserId: Types.ObjectId | null | undefined;
  userStoreIdLookup: (userId: string) => Promise<string | null>;
  fallbackStoreId: string | null;
}

/**
 * Resolve a loja dona de um produto para fins de backfill de estoque, priorizando
 * o storeId já gravado nos listings do produto sobre createdByUserId. Quando os
 * listings do produto apontam para lojas DIFERENTES entre si (produto vendido por
 * mais de uma loja), não há uma única resposta correta — cai para o próximo sinal
 * em vez de escolher arbitrariamente. Sem nenhum sinal e sem fallbackStoreId,
 * retorna null explícito (o chamador decide se pula ou usa um padrão).
 */
export async function resolveOwnerStoreByListing(params: ResolveOwnerStoreByListingParams): Promise<string | null> {
  const { listingStoreIds, createdByUserId, userStoreIdLookup, fallbackStoreId } = params;

  const uniqueListingStores = new Set(listingStoreIds.filter(Boolean).map((id) => String(id)));
  if (uniqueListingStores.size === 1) {
    return [...uniqueListingStores][0];
  }

  if (createdByUserId) {
    const storeId = await userStoreIdLookup(String(createdByUserId));
    if (storeId && Types.ObjectId.isValid(storeId)) return storeId;
  }

  return fallbackStoreId;
}
