import { StockMovementType, MOVEMENT_EFFECT } from './movement-type';

export interface BalanceDelta {
  onHand: number;
  reserved: number;
}

// `0 * -n` yields -0 in JS; normalize so deltas never carry negative zero.
const norm = (n: number): number => (n === 0 ? 0 : n);

/** Pure: given a movement type + quantity, the delta to apply to the materialized balance. */
export function computeBalanceDelta(type: StockMovementType, quantity: number): BalanceDelta {
  const effect = MOVEMENT_EFFECT[type];
  return {
    onHand: norm(effect.onHand * quantity),
    reserved: norm(effect.reserved * quantity),
  };
}
