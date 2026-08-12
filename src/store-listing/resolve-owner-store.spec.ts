import { Types } from 'mongoose';
import { resolveOwnerStore } from './resolve-owner-store';

describe('resolveOwnerStore', () => {
  const FALLBACK_STORE_ID = '6a00000000000000000000f0';

  it('resolves via createdByUserId when the user has a valid storeId', async () => {
    const userId = new Types.ObjectId('6a00000000000000000000a1');
    const userStoreId = '6a00000000000000000000b2';
    const lookup = jest.fn().mockResolvedValue(userStoreId);

    const result = await resolveOwnerStore({
      createdByUserId: userId,
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });

    expect(result).toBe(userStoreId);
    expect(lookup).toHaveBeenCalledWith(String(userId));
  });

  it('falls back when createdByUserId is absent', async () => {
    const lookup = jest.fn();
    const result = await resolveOwnerStore({
      createdByUserId: null,
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });
    expect(result).toBe(FALLBACK_STORE_ID);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls back when the user lookup returns null (user has no storeId)', async () => {
    const userId = new Types.ObjectId('6a00000000000000000000a1');
    const lookup = jest.fn().mockResolvedValue(null);
    const result = await resolveOwnerStore({
      createdByUserId: userId,
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });
    expect(result).toBe(FALLBACK_STORE_ID);
  });

  it('falls back when the resolved storeId is not a valid ObjectId string', async () => {
    const userId = new Types.ObjectId('6a00000000000000000000a1');
    const lookup = jest.fn().mockResolvedValue('not-a-valid-object-id');
    const result = await resolveOwnerStore({
      createdByUserId: userId,
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });
    expect(result).toBe(FALLBACK_STORE_ID);
  });
});
