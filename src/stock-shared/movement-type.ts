export enum StockMovementType {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  RESERVATION = 'reservation',
  RELEASE = 'release',
  TRANSFER = 'transfer',
  ADJUSTMENT = 'adjustment',
}

export interface MovementEffect {
  onHand: 1 | -1 | 0;
  reserved: 1 | -1 | 0;
  movesLocation: boolean;
}

/**
 * Single source of truth for how each movement type affects the materialized balance.
 * Used by the projection (write path) AND the reconciler (audit) — no duplicated $switch.
 */
export const MOVEMENT_EFFECT: Record<StockMovementType, MovementEffect> = {
  [StockMovementType.INBOUND]:     { onHand: 1,  reserved: 0,  movesLocation: false },
  [StockMovementType.OUTBOUND]:    { onHand: -1, reserved: 0,  movesLocation: false },
  [StockMovementType.RESERVATION]: { onHand: 0,  reserved: 1,  movesLocation: false },
  [StockMovementType.RELEASE]:     { onHand: 0,  reserved: -1, movesLocation: false },
  [StockMovementType.TRANSFER]:    { onHand: 0,  reserved: 0,  movesLocation: true  },
  [StockMovementType.ADJUSTMENT]:  { onHand: 1,  reserved: 0,  movesLocation: false }, // signed quantity
};

/** Legacy aliases → canonical. Used ONLY by the one-time data migration. */
export const LEGACY_TYPE_ALIASES: Record<string, StockMovementType> = {
  sale: StockMovementType.OUTBOUND,
  purchase_return: StockMovementType.INBOUND,
};

export type StockCondition = 'new' | 'used' | 'refurbished' | 'damaged';

/** Normalize a condition, accepting the legacy numeric conditionId (1=new,2=used,3=refurbished). */
export function resolveMovementCondition(
  condition?: StockCondition,
  legacyId?: number,
): StockCondition {
  if (condition === 'used' || condition === 'refurbished' || condition === 'new' || condition === 'damaged') return condition;
  if (legacyId === 2) return 'used';
  if (legacyId === 3) return 'refurbished';
  return 'new';
}

/** Map legacy/PT movement type strings to the canonical enum. */
export function resolveMovementType(legacy?: string): StockMovementType {
  switch ((legacy || 'inbound').toLowerCase()) {
    case 'saida':
    case 'outbound':
    case 'sale':
      return StockMovementType.OUTBOUND;
    case 'reservation':
      return StockMovementType.RESERVATION;
    case 'release':
      return StockMovementType.RELEASE;
    case 'transferencia':
    case 'transfer':
      return StockMovementType.TRANSFER;
    case 'adjustment':
    case 'ajuste':
      return StockMovementType.ADJUSTMENT;
    case 'entrada':
    case 'inbound':
    case 'purchase_return':
    default:
      return StockMovementType.INBOUND;
  }
}
