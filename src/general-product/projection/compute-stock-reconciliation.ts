export interface StockReconciliation {
  type: 'inbound' | 'adjustment';
  quantity: number;
}

/**
 * Decide o movimento de estoque para o produto projetado refletir `targetQty`,
 * dado o estoque já derivado dos stock_movements (`currentDerivedQty`). PURO.
 * - Sem estoque ainda e alvo > 0 → inbound do total.
 * - Diferença → adjustment do delta (pode ser negativo).
 * - Já bate (ou 0→0) → null (nenhum movimento).
 */
export function computeStockReconciliation(
  targetQty: number,
  currentDerivedQty: number,
): StockReconciliation | null {
  const target = Number.isFinite(Number(targetQty)) ? Number(targetQty) : 0;
  const current = Number.isFinite(Number(currentDerivedQty)) ? Number(currentDerivedQty) : 0;
  const delta = target - current;
  if (delta === 0) return null;
  if (current === 0 && target > 0) return { type: 'inbound', quantity: target };
  return { type: 'adjustment', quantity: delta };
}
