/**
 * Weighted-average unit cost after adding `inQty` units at `inCost` to a lot that already
 * holds `existingQty` units at `existingAvg`. Pure.
 */
export function weightedAverageCost(
  existingQty: number,
  existingAvg: number,
  inQty: number,
  inCost: number,
): number {
  if (inQty <= 0) return existingAvg;
  const totalQty = existingQty + inQty;
  if (totalQty <= 0) return existingAvg;
  return (existingQty * existingAvg + inQty * inCost) / totalQty;
}
