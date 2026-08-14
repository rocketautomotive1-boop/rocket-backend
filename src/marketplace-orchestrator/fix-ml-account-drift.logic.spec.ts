import { fixDriftItem } from '../../scripts/fix-ml-account-drift';

describe('fixDriftItem', () => {
  const listing = { _id: 'L1', productId: 'P1', storeId: 'STORE_RCK' };

  function makeDeps(overrides: Partial<{
    closeOnMarketplace: jest.Mock;
    clearListing: jest.Mock;
    requestResync: jest.Mock;
  }> = {}) {
    return {
      closeOnMarketplace: overrides.closeOnMarketplace ?? jest.fn().mockResolvedValue(undefined),
      clearListing: overrides.clearListing ?? jest.fn().mockResolvedValue(undefined),
      requestResync: overrides.requestResync ?? jest.fn().mockResolvedValue(undefined),
    };
  }

  it('executa os 3 passos em ordem quando tudo funciona', async () => {
    const deps = makeDeps();

    const results = await fixDriftItem({
      externalId: 'MLB1',
      listing,
      ...deps,
    });

    expect(deps.closeOnMarketplace).toHaveBeenCalledWith('MLB1');
    expect(deps.clearListing).toHaveBeenCalledWith('L1');
    expect(deps.requestResync).toHaveBeenCalledWith('P1', undefined);
    expect(results.map((r) => r.step)).toEqual(['closed', 'listing_cleared', 'resync_requested']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('regressão: se fechar no ML falhar, NÃO limpa o listing nem dispara resync (evita perder o vínculo de um anúncio ainda ativo)', async () => {
    const deps = makeDeps({ closeOnMarketplace: jest.fn().mockRejectedValue(new Error('403 forbidden')) });

    const results = await fixDriftItem({
      externalId: 'MLB1',
      listing,
      ...deps,
    });

    expect(deps.clearListing).not.toHaveBeenCalled();
    expect(deps.requestResync).not.toHaveBeenCalled();
    expect(results).toEqual([{ externalId: 'MLB1', productId: 'P1', step: 'closed', ok: false, detail: '403 forbidden' }]);
  });

  it('se limpar o listing falhar, não dispara resync (evita criar segundo anúncio sobre o listing antigo ainda com externalId)', async () => {
    const deps = makeDeps({ clearListing: jest.fn().mockRejectedValue(new Error('db down')) });

    const results = await fixDriftItem({
      externalId: 'MLB1',
      listing,
      ...deps,
    });

    expect(deps.requestResync).not.toHaveBeenCalled();
    expect(results.at(-1)).toEqual({ externalId: 'MLB1', productId: 'P1', step: 'listing_cleared', ok: false, detail: 'db down' });
  });

  it('se o resync falhar, ainda reporta os passos anteriores como concluídos (fechado + limpo, só falta resync — recuperável manualmente)', async () => {
    const deps = makeDeps({ requestResync: jest.fn().mockRejectedValue(new Error('outbox down')) });

    const results = await fixDriftItem({
      externalId: 'MLB1',
      listing,
      ...deps,
    });

    expect(results[0]).toEqual({ externalId: 'MLB1', productId: 'P1', step: 'closed', ok: true });
    expect(results[1]).toEqual({ externalId: 'MLB1', productId: 'P1', step: 'listing_cleared', ok: true });
    expect(results[2]).toEqual({ externalId: 'MLB1', productId: 'P1', step: 'resync_requested', ok: false, detail: 'outbox down' });
  });

  it('propaga requesterId para requestResync quando fornecido', async () => {
    const deps = makeDeps();

    await fixDriftItem({
      externalId: 'MLB1',
      listing,
      requesterId: 'user-42',
      ...deps,
    });

    expect(deps.requestResync).toHaveBeenCalledWith('P1', 'user-42');
  });
});
