import { StockCondition, StockMovementType } from '../../stock-shared/movement-type';
import { computeBalanceDelta } from '../../stock-shared/balance-math';

export interface LedgerEntry {
  storeListingId: string;
  condition: StockCondition;
  type: StockMovementType;
  quantity: number;
}

export interface BalanceEntry {
  storeListingId: string;
  condition: StockCondition;
  onHand: number;
}

export interface StockDivergence {
  storeListingId: string;
  condition: StockCondition;
  expected: number;
  actual: number;
  delta: number;
}

const key = (storeListingId: string, condition: StockCondition): string => `${storeListingId}:${condition}`;

/**
 * Pure: agrega ledger e projeção materializada por (storeListingId, condition) e reporta pares
 * cuja soma diverge. Reaproveita computeBalanceDelta — mesma lógica de sinal que a escrita usa
 * (movement-type.ts), sem duplicar o mapeamento tipo→efeito.
 */
export function computeDivergences(ledger: LedgerEntry[], balances: BalanceEntry[]): StockDivergence[] {
  const expected = new Map<string, { storeListingId: string; condition: StockCondition; onHand: number }>();
  for (const entry of ledger) {
    const k = key(entry.storeListingId, entry.condition);
    const current = expected.get(k) ?? { storeListingId: entry.storeListingId, condition: entry.condition, onHand: 0 };
    current.onHand += computeBalanceDelta(entry.type, entry.quantity).onHand;
    expected.set(k, current);
  }

  const actual = new Map<string, number>();
  for (const balance of balances) {
    const k = key(balance.storeListingId, balance.condition);
    actual.set(k, (actual.get(k) ?? 0) + balance.onHand);
  }

  const keys = new Set([...expected.keys(), ...actual.keys()]);
  const divergences: StockDivergence[] = [];
  for (const k of keys) {
    const exp = expected.get(k);
    const expectedOnHand = exp?.onHand ?? 0;
    const actualOnHand = actual.get(k) ?? 0;
    if (expectedOnHand === actualOnHand) continue;

    const [storeListingId, condition] = k.split(':') as [string, StockCondition];
    divergences.push({
      storeListingId,
      condition,
      expected: expectedOnHand,
      actual: actualOnHand,
      delta: expectedOnHand - actualOnHand,
    });
  }
  return divergences;
}
