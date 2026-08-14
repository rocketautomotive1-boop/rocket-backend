import { Types } from 'mongoose';
import { fixStoreListingChildStringTypes } from '../../scripts/fix-store-listing-child-string-types';

describe('fixStoreListingChildStringTypes', () => {
  it('regressão: converte storeListingId string para ObjectId', async () => {
    const storeListingId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), storeListingId: storeListingId.toString() };
    const updateOne = jest.fn().mockResolvedValue(undefined);

    const summary = await fixStoreListingChildStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).toHaveBeenCalledWith(doc._id, storeListingId);
    expect(summary.fixed).toBe(1);
  });

  it('pula quando storeListingId não é um ObjectId válido', async () => {
    const doc = { _id: new Types.ObjectId(), storeListingId: 'not-valid' };
    const updateOne = jest.fn();

    const summary = await fixStoreListingChildStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).not.toHaveBeenCalled();
    expect(summary.invalid).toBe(1);
  });

  it('dry-run: não chama updateOne', async () => {
    const doc = { _id: new Types.ObjectId(), storeListingId: new Types.ObjectId().toString() };
    const updateOne = jest.fn();

    const summary = await fixStoreListingChildStringTypes({ candidates: [doc], updateOne, dryRun: true });

    expect(updateOne).not.toHaveBeenCalled();
    expect(summary.fixed).toBe(1);
  });

  it('já ObjectId: converte sem erro (idempotência)', async () => {
    const storeListingId = new Types.ObjectId();
    const doc = { _id: new Types.ObjectId(), storeListingId };
    const updateOne = jest.fn().mockResolvedValue(undefined);

    const summary = await fixStoreListingChildStringTypes({ candidates: [doc], updateOne, dryRun: false });

    expect(updateOne).toHaveBeenCalledWith(doc._id, storeListingId);
    expect(summary.fixed).toBe(1);
  });
});
