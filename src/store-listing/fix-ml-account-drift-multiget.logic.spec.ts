import { Types } from 'mongoose';
import { fixMlAccountDrift, DriftRow } from '../../scripts/fix-ml-account-drift-multiget';

function oid() {
  return new Types.ObjectId();
}

function row(overrides: Partial<DriftRow> = {}): DriftRow {
  return {
    externalId: 'MLB1',
    productId: String(oid()),
    listingId: String(oid()),
    storeId: String(oid()),
    realAccountId: 'account-real',
    expectedAccountId: 'account-expected',
    ...overrides,
  };
}

describe('fixMlAccountDrift', () => {
  it('chama transferOwnership com fromStoreId = storeId atual e toStoreId = loja da conta real', async () => {
    const drift = row();
    const realStoreId = oid();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(realStoreId);
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'repoint' as const });

    const summary = await fixMlAccountDrift({
      driftRows: [drift],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(resolveStoreForAccount).toHaveBeenCalledWith(drift.realAccountId);
    expect(transferOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: drift.productId,
        fromStoreId: drift.storeId,
        toStoreId: String(realStoreId),
        dryRun: true,
      }),
    );
    expect(summary.totalDriftRows).toBe(1);
    expect(summary.productsTransferred).toBe(1);
    expect(summary.repointed).toBe(1);
  });

  it('agrupa por (productId, storeId atual, conta real) — um mesmo produto com múltiplos listings drift chama transferOwnership uma única vez', async () => {
    const productId = String(oid());
    const storeId = String(oid());
    const drift = [
      row({ productId, storeId, externalId: 'MLB1', realAccountId: 'account-real' }),
      row({ productId, storeId, externalId: 'MLB2', realAccountId: 'account-real' }),
    ];
    const realStoreId = oid();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(realStoreId);
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'repoint' as const });

    const summary = await fixMlAccountDrift({
      driftRows: drift,
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(transferOwnership).toHaveBeenCalledTimes(1);
    expect(summary.totalDriftRows).toBe(2);
    expect(summary.productsTransferred).toBe(1);
  });

  it('conta separadamente quando não há loja mapeada para a conta real, sem chamar transferOwnership', async () => {
    const drift = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(null);
    const transferOwnership = jest.fn();

    const summary = await fixMlAccountDrift({
      driftRows: [drift],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(transferOwnership).not.toHaveBeenCalled();
    expect(summary.noStoreMappedForAccount).toBe(1);
    expect(summary.productsTransferred).toBe(0);
  });

  it('um grupo bloqueado (boxId) não interrompe os demais grupos', async () => {
    const groups = [row({ productId: String(oid()) }), row({ productId: String(oid()) })];
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('Transferência bloqueada: StoreListing X tem saldo com boxId preenchido');
      return { kind: 'repoint' as const };
    });

    const summary = await fixMlAccountDrift({
      driftRows: groups,
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.blocked).toBe(1);
    expect(summary.repointed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('erro inesperado conta como failed e não interrompe os demais grupos', async () => {
    const groups = [row({ productId: String(oid()) }), row({ productId: String(oid()) })];
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('erro inesperado de rede');
      return { kind: 'repoint' as const };
    });

    const summary = await fixMlAccountDrift({
      driftRows: groups,
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.failed).toBe(1);
    expect(summary.repointed).toBe(1);
  });

  it('conta merge separadamente de repoint', async () => {
    const drift = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'merge' as const });

    const summary = await fixMlAccountDrift({
      driftRows: [drift],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
    });

    expect(summary.merged).toBe(1);
    expect(summary.repointed).toBe(0);
  });

  it('conflito de merge transitório (StoreListing recriado por dual-write concorrente) — reexecuta e sucede', async () => {
    const drift = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    let call = 0;
    const transferOwnership = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('Conflito de merge: já existe marketplace_listing mercadolivre/MLB1 sob o StoreListing de destino X.');
      return { kind: 'repoint' as const };
    });
    const wait = jest.fn().mockResolvedValue(undefined);

    const summary = await fixMlAccountDrift({
      driftRows: [drift],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
      wait,
    });

    expect(transferOwnership).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(summary.repointed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('conflito de merge persistente após esgotar as tentativas conta como failed', async () => {
    const drift = row();
    const resolveStoreForAccount = jest.fn().mockResolvedValue(oid());
    const transferOwnership = jest.fn().mockRejectedValue(
      new Error('Conflito de merge: já existe marketplace_listing mercadolivre/MLB1 sob o StoreListing de destino X.'),
    );
    const wait = jest.fn().mockResolvedValue(undefined);

    const summary = await fixMlAccountDrift({
      driftRows: [drift],
      resolveStoreForAccount,
      transferOwnership,
      dryRun: true,
      wait,
    });

    expect(transferOwnership).toHaveBeenCalledTimes(3);
    expect(summary.failed).toBe(1);
  });
});
