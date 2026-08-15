import { StoreListingDamagedAllocationSchema } from './store-listing-damaged-allocation.schema';

describe('StoreListingDamagedAllocationSchema', () => {
  it('requires damagedUnitId and warehouseId', () => {
    expect(StoreListingDamagedAllocationSchema.path('damagedUnitId').isRequired).toBe(true);
    expect(StoreListingDamagedAllocationSchema.path('warehouseId').isRequired).toBe(true);
  });

  it('has a unique index on damagedUnitId (1:1 allocation)', () => {
    const indexes = StoreListingDamagedAllocationSchema.indexes();
    const idx = indexes.find(([keys]: any) => keys.damagedUnitId === 1);
    expect(idx).toBeDefined();
    expect(idx?.[1]?.unique).toBe(true);
  });
});
