import { Types } from 'mongoose';
import { fixStoreListingStringTypes } from '../../scripts/fix-store-listing-string-types';

describe('fixStoreListingStringTypes', () => {
  function makeDeps(overrides: Partial<{
    findExisting: jest.Mock;
    updateOne: jest.Mock;
    mergeInto: jest.Mock;
  }> = {}) {
    return {
      findExisting: overrides.findExisting ?? jest.fn().mockResolvedValue(null),
      updateOne: overrides.updateOne ?? jest.fn().mockResolvedValue(undefined),
      mergeInto: overrides.mergeInto ?? jest.fn().mockResolvedValue(undefined),
    };
  }

  it('regressão: converte productId/storeId string para ObjectId quando não há conflito', async () => {
    const productId = new Types.ObjectId();
    const storeId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), productId: productId.toString(), storeId: storeId.toString() };
    const deps = makeDeps();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: false });

    expect(deps.updateOne).toHaveBeenCalledWith(doc._id, productId, storeId);
    expect(deps.mergeInto).not.toHaveBeenCalled();
    expect(summary.fixed).toBe(1);
  });

  it('regressão: quando já existe StoreListing com o mesmo (productId, storeId) como ObjectId — faz merge, nunca updateOne (evita E11000 duplicate key)', async () => {
    const productId = new Types.ObjectId();
    const storeId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), productId: productId.toString(), storeId: storeId.toString() };
    const conflictingId = new Types.ObjectId();
    const deps = makeDeps({ findExisting: jest.fn().mockResolvedValue(conflictingId) });

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: false });

    expect(deps.mergeInto).toHaveBeenCalledWith(doc._id, conflictingId);
    expect(deps.updateOne).not.toHaveBeenCalled();
    expect(summary.merged).toBe(1);
    expect(summary.fixed).toBe(0);
  });

  it('pula (não converte) quando productId ou storeId não é um ObjectId válido', async () => {
    const doc = { _id: new Types.ObjectId(), productId: 'not-valid', storeId: new Types.ObjectId().toString() };
    const deps = makeDeps();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: false });

    expect(deps.updateOne).not.toHaveBeenCalled();
    expect(deps.findExisting).not.toHaveBeenCalled();
    expect(summary.invalid).toBe(1);
    expect(summary.fixed).toBe(0);
  });

  it('dry-run: conta como fixed sem chamar updateOne', async () => {
    const doc = { _id: new Types.ObjectId(), productId: new Types.ObjectId().toString(), storeId: new Types.ObjectId().toString() };
    const deps = makeDeps();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: true });

    expect(deps.updateOne).not.toHaveBeenCalled();
    expect(summary.fixed).toBe(1);
  });

  it('dry-run com conflito: conta como merged sem chamar mergeInto', async () => {
    const doc = { _id: new Types.ObjectId(), productId: new Types.ObjectId().toString(), storeId: new Types.ObjectId().toString() };
    const deps = makeDeps({ findExisting: jest.fn().mockResolvedValue(new Types.ObjectId()) });

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: true });

    expect(deps.mergeInto).not.toHaveBeenCalled();
    expect(summary.merged).toBe(1);
  });

  it('já ObjectId (não string): converte sem erro (idempotência via String() do próprio ObjectId)', async () => {
    const productId = new Types.ObjectId();
    const storeId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), productId, storeId };
    const deps = makeDeps();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], ...deps, dryRun: false });

    expect(deps.updateOne).toHaveBeenCalledWith(doc._id, productId, storeId);
    expect(summary.fixed).toBe(1);
  });
});
