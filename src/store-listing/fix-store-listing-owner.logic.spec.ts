import { Types } from 'mongoose';
import { fixStoreListingOwner, StoreListingMismatch } from '../../scripts/fix-store-listing-owner';

describe('fixStoreListingOwner', () => {
  function makeMismatch(overrides: Partial<StoreListingMismatch> = {}): StoreListingMismatch {
    return {
      storeListingId: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      currentStoreId: new Types.ObjectId(),
      correctStoreId: new Types.ObjectId(),
      ...overrides,
    };
  }

  function makeDeps(overrides: Partial<{
    hasStoreListingAt: jest.Mock;
    rekey: jest.Mock;
    mergeInto: jest.Mock;
  }> = {}) {
    return {
      hasStoreListingAt: overrides.hasStoreListingAt ?? jest.fn().mockResolvedValue(null),
      rekey: overrides.rekey ?? jest.fn().mockResolvedValue(undefined),
      mergeInto: overrides.mergeInto ?? jest.fn().mockResolvedValue(undefined),
    };
  }

  it('regressão: sem conflito (nenhum StoreListing já existe na loja correta) — faz re-key simples', async () => {
    const mismatch = makeMismatch();
    const deps = makeDeps();

    const summary = await fixStoreListingOwner({ mismatches: [mismatch], ...deps, dryRun: false });

    expect(deps.rekey).toHaveBeenCalledWith(mismatch.storeListingId, mismatch.correctStoreId);
    expect(deps.mergeInto).not.toHaveBeenCalled();
    expect(summary.rekeyed).toBe(1);
    expect(summary.merged).toBe(0);
  });

  it('regressão: com conflito (já existe StoreListing na loja correta) — faz merge, nunca re-key', async () => {
    const mismatch = makeMismatch();
    const conflictingId = new Types.ObjectId();
    const deps = makeDeps({ hasStoreListingAt: jest.fn().mockResolvedValue(conflictingId) });

    const summary = await fixStoreListingOwner({ mismatches: [mismatch], ...deps, dryRun: false });

    expect(deps.mergeInto).toHaveBeenCalledWith(mismatch.storeListingId, conflictingId);
    expect(deps.rekey).not.toHaveBeenCalled();
    expect(summary.merged).toBe(1);
    expect(summary.rekeyed).toBe(0);
  });

  it('dry-run: não chama rekey nem mergeInto, só conta', async () => {
    const mismatch = makeMismatch();
    const deps = makeDeps({ hasStoreListingAt: jest.fn().mockResolvedValue(null) });

    const summary = await fixStoreListingOwner({ mismatches: [mismatch], ...deps, dryRun: true });

    expect(deps.rekey).not.toHaveBeenCalled();
    expect(deps.mergeInto).not.toHaveBeenCalled();
    expect(summary.rekeyed).toBe(1);
  });

  it('dry-run com conflito: conta como merged sem chamar nada', async () => {
    const mismatch = makeMismatch();
    const deps = makeDeps({ hasStoreListingAt: jest.fn().mockResolvedValue(new Types.ObjectId()) });

    const summary = await fixStoreListingOwner({ mismatches: [mismatch], ...deps, dryRun: true });

    expect(deps.mergeInto).not.toHaveBeenCalled();
    expect(summary.merged).toBe(1);
  });

  it('erro num item não interrompe o processamento dos demais', async () => {
    const m1 = makeMismatch();
    const m2 = makeMismatch();
    const deps = makeDeps({
      rekey: jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    });

    const summary = await fixStoreListingOwner({ mismatches: [m1, m2], ...deps, dryRun: false });

    expect(summary.errors).toBe(1);
    expect(summary.rekeyed).toBe(1);
    expect(deps.rekey).toHaveBeenCalledTimes(2);
  });
});
