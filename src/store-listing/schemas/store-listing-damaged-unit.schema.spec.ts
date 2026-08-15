import { StoreListingDamagedUnitSchema } from './store-listing-damaged-unit.schema';

describe('StoreListingDamagedUnitSchema', () => {
  it('requires storeListingId, sourceLotId, condition, and status', () => {
    expect(StoreListingDamagedUnitSchema.path('storeListingId').isRequired).toBe(true);
    expect(StoreListingDamagedUnitSchema.path('sourceLotId').isRequired).toBe(true);
    expect(StoreListingDamagedUnitSchema.path('condition').isRequired).toBe(true);
    expect(StoreListingDamagedUnitSchema.path('status').isRequired).toBe(true);
  });

  it('defaults status to in_stock and price to null', () => {
    const statusPath = StoreListingDamagedUnitSchema.path('status') as any;
    expect(statusPath.defaultValue).toBe('in_stock');
    const pricePath = StoreListingDamagedUnitSchema.path('price') as any;
    expect(pricePath.defaultValue).toBeNull();
  });

  it('defaults photos to an empty array', () => {
    const photosPath = StoreListingDamagedUnitSchema.path('photos') as any;
    const defaultValue =
      typeof photosPath.defaultValue === 'function' ? photosPath.defaultValue() : photosPath.defaultValue;
    expect(defaultValue).toEqual([]);
  });
});
