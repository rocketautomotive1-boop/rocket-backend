import { Types } from 'mongoose';
import { fixListingStoreIdVsAccountId, CandidateRow } from '../../scripts/fix-listing-storeid-vs-accountid';

function oid() {
  return new Types.ObjectId();
}

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    productId: oid(),
    listingId: oid(),
    externalId: 'MLB123',
    accountId: 'account-1',
    currentStoreId: oid(),
    ...overrides,
  };
}

describe('fixListingStoreIdVsAccountId', () => {
  it('chama transferOwnership com a loja correta resolvida a partir do accountId', async () => {
    const candidate = row();
    const correctStoreId = oid();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(correctStoreId);
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'repoint' as const });

    const summary = await fixListingStoreIdVsAccountId({
      candidates: [candidate],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(resolveStoreForAccount).toHaveBeenCalledWith('account-1');
    expect(transferOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: String(candidate.productId),
        fromStoreId: String(candidate.currentStoreId),
        toStoreId: String(correctStoreId),
        dryRun: true,
      }),
    );
    expect(summary.totalCandidates).toBe(1);
    expect(summary.repointed).toBe(1);
  });

  it('conta separadamente quando não há loja mapeada para o accountId, sem chamar transferOwnership', async () => {
    const candidate = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(null);
    const transferOwnership = jest.fn();

    const summary = await fixListingStoreIdVsAccountId({
      candidates: [candidate],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(transferOwnership).not.toHaveBeenCalled();
    expect(summary.noStoreMappedForAccount).toBe(1);
    expect(summary.repointed).toBe(0);
  });

  it('conta merge separadamente de repoint', async () => {
    const candidate = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'merge' as const });

    const summary = await fixListingStoreIdVsAccountId({
      candidates: [candidate],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.merged).toBe(1);
    expect(summary.repointed).toBe(0);
  });

  it('um caso bloqueado (boxId) não interrompe os demais candidatos', async () => {
    const candidates = [row(), row()];
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('Transferência bloqueada: StoreListing X tem saldo com boxId preenchido');
      return { kind: 'repoint' as const };
    });

    const summary = await fixListingStoreIdVsAccountId({
      candidates,
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.blocked).toBe(1);
    expect(summary.repointed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('erro inesperado conta como failed e não interrompe os demais candidatos', async () => {
    const candidates = [row(), row()];
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('erro inesperado de rede');
      return { kind: 'repoint' as const };
    });

    const summary = await fixListingStoreIdVsAccountId({
      candidates,
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.failed).toBe(1);
    expect(summary.repointed).toBe(1);
  });
});
