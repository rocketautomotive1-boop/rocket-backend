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
