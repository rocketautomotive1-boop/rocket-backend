import { Types } from 'mongoose';
import { resolveOwnerStore, resolveOwnerStoreByListing } from './resolve-owner-store';

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

describe('resolveOwnerStoreByListing', () => {
  const FALLBACK_STORE_ID = '6a00000000000000000000f0';
  const STORE_A = '6a00000000000000000000a1';
  const STORE_B = '6a00000000000000000000b2';

  it('regressão: prioriza o storeId já gravado nos listings sobre createdByUserId (caso real: produto sem createdByUserId, listing.storeId já correto)', async () => {
    const lookup = jest.fn();

    const result = await resolveOwnerStoreByListing({
      listingStoreIds: [STORE_A],
      createdByUserId: null,
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });

    expect(result).toBe(STORE_A);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ignora listingStoreIds vazio/ausente e cai para createdByUserId', async () => {
    const lookup = jest.fn().mockResolvedValue(STORE_B);

    const result = await resolveOwnerStoreByListing({
      listingStoreIds: [],
      createdByUserId: new Types.ObjectId('6a00000000000000000000c3'),
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });

    expect(result).toBe(STORE_B);
  });

  it('produto com listings em lojas DIFERENTES: não escolhe arbitrariamente, cai para o próximo sinal', async () => {
    const lookup = jest.fn().mockResolvedValue(STORE_B);

    const result = await resolveOwnerStoreByListing({
      listingStoreIds: [STORE_A, STORE_B],
      createdByUserId: new Types.ObjectId('6a00000000000000000000c3'),
      userStoreIdLookup: lookup,
      fallbackStoreId: FALLBACK_STORE_ID,
    });

    expect(result).toBe(STORE_B);
  });

  it('sem nenhum sinal e sem fallbackStoreId, retorna null explícito (não força uma loja)', async () => {
    const lookup = jest.fn();

    const result = await resolveOwnerStoreByListing({
      listingStoreIds: [],
      createdByUserId: null,
      userStoreIdLookup: lookup,
      fallbackStoreId: null,
    });

    expect(result).toBeNull();
  });

  it('sem nenhum sinal, usa fallbackStoreId quando fornecido', async () => {
    const result = await resolveOwnerStoreByListing({
      listingStoreIds: [],
      createdByUserId: null,
      userStoreIdLookup: jest.fn(),
      fallbackStoreId: FALLBACK_STORE_ID,
    });

    expect(result).toBe(FALLBACK_STORE_ID);
  });
});
