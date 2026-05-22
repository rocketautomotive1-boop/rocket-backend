export const PRODUCT_EVENTS = {
  UPDATED: 'product.updated',
} as const;

export class ProductUpdatedEvent {
  constructor(
    public readonly productId: string,
    public readonly changedFields: string[],
    public readonly snapshot: {
      weight?: number;
      dimensions?: { height: number; width: number; length: number };
    },
  ) {}
}
