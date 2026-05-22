export interface ProductDimensionsSnapshot {
  weight?: number;
  dimensions?: { height: number; width: number; length: number };
}

export class ProductUpdatedEvent {
  constructor(
    public readonly productId: string,
    public readonly changedFields: string[],
    public readonly snapshot: ProductDimensionsSnapshot,
  ) {}
}

export const PRODUCT_EVENTS = {
  UPDATED: 'product.updated',
} as const;
