import {
  fixWrongStoreNeverPublished,
  CandidateProduct,
} from '../../scripts/fix-wrong-store-never-published';

function candidate(overrides: Partial<CandidateProduct> = {}): CandidateProduct {
  return {
    productId: 'product-1',
    partNumber: '9821596880',
    fromStoreId: 'rck-automotive',
    ...overrides,
  };
}

describe('fixWrongStoreNeverPublished', () => {
  it('chama transferOwnership uma vez por candidato e conta repoint/merge separadamente', async () => {
    const c1 = candidate({ productId: 'p1' });
    const c2 = candidate({ productId: 'p2', partNumber: '19347751' });
    const transferOwnership = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'repoint' })
      .mockResolvedValueOnce({ kind: 'merge' });

    const summary = await fixWrongStoreNeverPublished({
      candidates: [c1, c2],
      transferOwnership,
      dryRun: false,
    });

    expect(transferOwnership).toHaveBeenCalledTimes(2);
    expect(transferOwnership).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ productId: 'p1', fromStoreId: 'rck-automotive', toStoreId: '6a7cff4bf323afb241284d0c' }),
    );
    expect(summary).toEqual({ total: 2, repointed: 1, merged: 1, noop: 0, blocked: 0, failed: 0 });
  });

  it('propaga dryRun para transferOwnership sem alterar a contagem', async () => {
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'repoint' });
    await fixWrongStoreNeverPublished({
      candidates: [candidate()],
      transferOwnership,
      dryRun: true,
    });
    expect(transferOwnership).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('conta noop quando o produto não tem StoreListing na loja de origem', async () => {
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'noop' });
    const summary = await fixWrongStoreNeverPublished({
      candidates: [candidate()],
      transferOwnership,
      dryRun: false,
    });
    expect(summary.noop).toBe(1);
  });

  it('conta blocked quando transferOwnership rejeita por boxId (depósito físico)', async () => {
    const transferOwnership = jest.fn().mockRejectedValue(new Error('StoreListing X tem saldo com boxId preenchido'));
    const summary = await fixWrongStoreNeverPublished({
      candidates: [candidate()],
      transferOwnership,
      dryRun: false,
    });
    expect(summary.blocked).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('conta failed para qualquer outro erro e continua processando os demais candidatos', async () => {
    const c1 = candidate({ productId: 'p1' });
    const c2 = candidate({ productId: 'p2' });
    const transferOwnership = jest
      .fn()
      .mockRejectedValueOnce(new Error('erro de conexão transitório'))
      .mockResolvedValueOnce({ kind: 'repoint' });

    const summary = await fixWrongStoreNeverPublished({
      candidates: [c1, c2],
      transferOwnership,
      dryRun: false,
    });

    expect(summary.failed).toBe(1);
    expect(summary.repointed).toBe(1);
    expect(transferOwnership).toHaveBeenCalledTimes(2);
  });

  it('reporta o outcome de cada candidato via onProgress', async () => {
    const transferOwnership = jest.fn().mockResolvedValue({ kind: 'merge' });
    const onProgress = jest.fn();
    await fixWrongStoreNeverPublished({
      candidates: [candidate({ productId: 'p1' })],
      transferOwnership,
      dryRun: false,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1' }), 'merge');
  });
});
