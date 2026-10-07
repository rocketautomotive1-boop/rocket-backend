import { Types } from 'mongoose';
import { migrateOwnership } from '../../scripts/transfer-store-listing-ownership';

function oid() {
  return new Types.ObjectId();
}

describe('migrateOwnership', () => {
  it('conta repoint/merge/noop separadamente', async () => {
    const cases = [
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
    ];

    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) return { kind: 'repoint' as const };
      if (call === 2) return { kind: 'merge' as const };
      return { kind: 'noop' as const };
    });

    const summary = await migrateOwnership({ cases, transferOwnership, dryRun: true });

    expect(summary.totalCandidates).toBe(3);
    expect(summary.repointed).toBe(1);
    expect(summary.merged).toBe(1);
    expect(summary.noop).toBe(1);
    expect(summary.blocked).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('um caso bloqueado (boxId) não interrompe os demais', async () => {
    const cases = [
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
    ];

    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('Transferência bloqueada: StoreListing X tem saldo com boxId preenchido');
      return { kind: 'repoint' as const };
    });

    const summary = await migrateOwnership({ cases, transferOwnership, dryRun: true });

    expect(summary.blocked).toBe(1);
    expect(summary.repointed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('erro inesperado conta como failed, não interrompe os demais', async () => {
    const cases = [
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
      { productId: oid(), fromStoreId: oid(), toStoreId: oid() },
    ];

    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('Conflito de merge: já existe marketplace_listing');
      return { kind: 'repoint' as const };
    });

    const summary = await migrateOwnership({ cases, transferOwnership, dryRun: true });

    expect(summary.failed).toBe(1);
    expect(summary.repointed).toBe(1);
  });

  it('passa dryRun adiante para transferOwnership', async () => {
    const cases = [{ productId: oid(), fromStoreId: oid(), toStoreId: oid() }];
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'repoint' });

    await migrateOwnership({ cases, transferOwnership, dryRun: false });

    expect(transferOwnership).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });
});
