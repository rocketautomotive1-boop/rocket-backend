// backend/src/store-listing/ownership-transfer.logic.ts
/**
 * Lógica pura da transferência de propriedade de um StoreListing entre lojas — o ÚNICO caminho
 * permitido para mudar o dono de um listing/StoreListing. Existe porque o dual-write
 * (ListingService.mirrorToStoreListing) espelha ListingModel.storeId em StoreListing/
 * MarketplaceListing/estoque de forma assíncrona e SEM invalidação: corrigir só
 * ListingModel.storeId (como os scripts fix-listing-store-owner.ts e
 * verify-listing-store-owner-ml.ts fazem, de propósito, dentro do escopo deles) deixa o
 * StoreListing/estoque/marketplace_listings materializados sob a loja antiga — a causa raiz dos
 * 883 casos encontrados por report-wrong-store-listings.ts (2026-08-30).
 *
 * Ver docs/superpowers/specs/2026-08-30-store-listing-ownership-transfer-design.md.
 *
 * Dois caminhos, decididos pelo estado do destino:
 *   - REPOINT (destino livre — não existe StoreListing(productId, toStoreId)): reaponta o
 *     storeId do próprio documento StoreListing. Todos os filhos (lots/balances/movements/
 *     marketplace_listings/damaged_units, todos referenciando storeListingId, nunca storeId
 *     diretamente) continuam válidos sem qualquer escrita neles. Caminho barato e seguro —
 *     896,5% dos 883 casos reais (852/883).
 *   - MERGE (destino ocupado — já existe StoreListing(productId, toStoreId) real): soma balances
 *     por condition no destino, move lots/movements/damaged_units/marketplace_listings trocando
 *     storeListingId origem→destino, depois apaga o StoreListing de origem (agora vazio) e seus
 *     balances remanescentes. 31/883 casos reais.
 *
 * Fora de escopo (confirmado pelo relatório: 0/883 casos): boxId preenchido (depósito físico) e
 * damaged units — a lógica de merge REJEITA (não ignora silenciosamente) qualquer StoreListing de
 * origem com balance.boxId != null, porque mover um boxId sem realocação física real corromperia
 * a localização do estoque. Se esse caso aparecer no futuro, precisa de design próprio.
 */
import { Types } from 'mongoose';
import { StockCondition } from '../stock-shared/movement-type';

export interface TransferBalanceRow {
  _id: Types.ObjectId;
  condition: StockCondition;
  onHand: number;
  reserved: number;
  boxId: Types.ObjectId | null;
}

export interface TransferPlanInput {
  productId: Types.ObjectId;
  fromStoreId: Types.ObjectId;
  toStoreId: Types.ObjectId;
  sourceStoreListing: { _id: Types.ObjectId; storeId: Types.ObjectId } | null;
  destinationStoreListing: { _id: Types.ObjectId; storeId: Types.ObjectId } | null;
  sourceBalances: TransferBalanceRow[];
}

export type TransferPlan =
  | { kind: 'noop'; reason: 'no_source_store_listing' }
  | { kind: 'repoint'; sourceStoreListingId: Types.ObjectId }
  | {
      kind: 'merge';
      sourceStoreListingId: Types.ObjectId;
      destinationStoreListingId: Types.ObjectId;
    }
  | { kind: 'blocked'; reason: 'box_id_present'; storeListingId: Types.ObjectId };

/**
 * Decide o plano de transferência a partir do estado atual — não executa nenhuma escrita. Toda
 * decisão condicional da operação vive aqui, isolada de I/O, para ser testável sem Mongo.
 */
export function planOwnershipTransfer(input: TransferPlanInput): TransferPlan {
  const { sourceStoreListing, destinationStoreListing, sourceBalances } = input;

  if (!sourceStoreListing) {
    return { kind: 'noop', reason: 'no_source_store_listing' };
  }

  const hasBoxId = sourceBalances.some((b) => b.boxId != null);
  if (hasBoxId) {
    return { kind: 'blocked', reason: 'box_id_present', storeListingId: sourceStoreListing._id };
  }

  if (!destinationStoreListing) {
    return { kind: 'repoint', sourceStoreListingId: sourceStoreListing._id };
  }

  return {
    kind: 'merge',
    sourceStoreListingId: sourceStoreListing._id,
    destinationStoreListingId: destinationStoreListing._id,
  };
}

/**
 * Combina balances de origem+destino por condition, somando onHand/reserved — usado só no
 * caminho MERGE. Nunca produz boxId (bloqueado antes por planOwnershipTransfer), sempre null.
 */
export function mergeBalancesByCondition(
  sourceBalances: TransferBalanceRow[],
  destinationBalances: TransferBalanceRow[],
): Array<{ condition: StockCondition; onHand: number; reserved: number }> {
  const byCondition = new Map<StockCondition, { onHand: number; reserved: number }>();

  for (const b of [...destinationBalances, ...sourceBalances]) {
    const acc = byCondition.get(b.condition) ?? { onHand: 0, reserved: 0 };
    acc.onHand += b.onHand;
    acc.reserved += b.reserved;
    byCondition.set(b.condition, acc);
  }

  return Array.from(byCondition.entries()).map(([condition, v]) => ({ condition, ...v }));
}
