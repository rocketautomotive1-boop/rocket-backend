import { Types } from 'mongoose';
import { fixStoreListingStringTypes } from '../../scripts/fix-store-listing-string-types';

describe('fixStoreListingStringTypes', () => {
  it('regressão: converte productId/storeId string para ObjectId', async () => {
    const productId = new Types.ObjectId();
    const storeId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), productId: productId.toString(), storeId: storeId.toString() };
    const updateOne = jest.fn().mockResolvedValue(undefined);

    const summary = await fixStoreListingStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).toHaveBeenCalledWith(doc._id, productId, storeId);
    expect(summary.fixed).toBe(1);
  });

  it('pula (não converte) quando productId ou storeId não é um ObjectId válido', async () => {
    const doc = { _id: new Types.ObjectId(), productId: 'not-valid', storeId: new Types.ObjectId().toString() };
    const updateOne = jest.fn();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).not.toHaveBeenCalled();
    expect(summary.invalid).toBe(1);
    expect(summary.fixed).toBe(0);
  });

  it('dry-run: conta como fixed sem chamar updateOne', async () => {
    const doc = { _id: new Types.ObjectId(), productId: new Types.ObjectId().toString(), storeId: new Types.ObjectId().toString() };
    const updateOne = jest.fn();

    const summary = await fixStoreListingStringTypes({ candidates: [doc], updateOne, dryRun: true });

    expect(updateOne).not.toHaveBeenCalled();
    expect(summary.fixed).toBe(1);
  });

  it('já ObjectId (não string): converte sem erro (idempotência via String() do próprio ObjectId)', async () => {
    const productId = new Types.ObjectId();
    const storeId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), productId, storeId };
    const updateOne = jest.fn().mockResolvedValue(undefined);

    const summary = await fixStoreListingStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).toHaveBeenCalledWith(doc._id, productId, storeId);
    expect(summary.fixed).toBe(1);
  });
});
