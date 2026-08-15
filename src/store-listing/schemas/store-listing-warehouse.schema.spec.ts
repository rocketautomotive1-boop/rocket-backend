import { StoreListingWarehouseSchema } from './store-listing-warehouse.schema';

describe('StoreListingWarehouseSchema', () => {
  it('requires storeId and name', () => {
    expect(StoreListingWarehouseSchema.path('storeId').isRequired).toBe(true);
    expect(StoreListingWarehouseSchema.path('name').isRequired).toBe(true);
  });

  it('has a unique compound index on {storeId, name}', () => {
    const indexes = StoreListingWarehouseSchema.indexes();
    const compound = indexes.find(([keys]: any) => keys.storeId === 1 && keys.name === 1);
    expect(compound).toBeDefined();
    expect(compound?.[1]?.unique).toBe(true);
  });
});
