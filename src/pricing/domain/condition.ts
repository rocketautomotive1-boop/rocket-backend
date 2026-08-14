export type StockCondition = 'new' | 'damaged' | 'used' | 'refurbished';

/** A condition is "new" when it is undefined, empty, or the literal 'new'. */
export function isNewCondition(condition?: string | null): boolean {
  return !condition || condition === 'new';
}
