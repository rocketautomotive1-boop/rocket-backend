import { Types } from 'mongoose';
import {
  canAccountReadItem,
  resolveTrueOwnerAccountId,
  verifyListingStoreOwnerML,
  VerifyListingRow,
  AccountCandidate,
} from '../../scripts/verify-listing-store-owner-ml';

describe('canAccountReadItem', () => {
  it('retorna true quando a API responde 200 (a conta lê o item)', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({ status: 200 });
    const ok = await canAccountReadItem('MLB123', 'TOKEN', fakeFetch as any);
    expect(ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/items/MLB123',
      expect.objectContaining({ headers: { Authorization: 'Bearer TOKEN' } }),
    );
  });

  it('retorna false em 403 (não é dono)', async () => {
    const fakeFetch = jest.fn().mockResolvedValue({ status: 403 });
    const ok = await canAccountReadItem('MLB123', 'TOKEN', fakeFetch as any);
    expect(ok).toBe(false);
  });

  it('retorna false em erro de rede — nunca assume propriedade sem 200 explícito', async () => {
    const fakeFetch = jest.fn().mockRejectedValue(new Error('network error'));
    const ok = await canAccountReadItem('MLB123', 'TOKEN', fakeFetch as any);
    expect(ok).toBe(false);
  });
});

describe('resolveTrueOwnerAccountId', () => {
  const accounts: AccountCandidate[] = [
    { accountId: 'A1', accessToken: 'TOKEN_A1' },
    { accountId: 'A2', accessToken: 'TOKEN_A2' },
    { accountId: 'A3', accessToken: 'TOKEN_A3' },
  ];
  const noSleep = () => Promise.resolve();

  it('testa a conta ATUAL primeiro — se ela lê, não testa mais nenhuma', async () => {
    const readItem = jest.fn().mockResolvedValue(true);
    const owner = await resolveTrueOwnerAccountId('MLB1', 'A2', accounts, readItem, noSleep);
    expect(owner).toBe('A2');
    expect(readItem).toHaveBeenCalledTimes(1);
    expect(readItem).toHaveBeenCalledWith('MLB1', 'TOKEN_A2');
  });

  it('se a conta atual falha, tenta as outras em sequência até achar a dona', async () => {
    const readItem = jest
      .fn()
      .mockResolvedValueOnce(false) // A2 (atual) falha
      .mockResolvedValueOnce(false) // A1 falha
      .mockResolvedValueOnce(true); // A3 lê
    const owner = await resolveTrueOwnerAccountId('MLB1', 'A2', accounts, readItem, noSleep);
    expect(owner).toBe('A3');
    expect(readItem).toHaveBeenCalledTimes(3);
  });

  it('retorna null quando NENHUMA conta consegue ler — nunca força um palpite', async () => {
    const readItem = jest.fn().mockResolvedValue(false);
    const owner = await resolveTrueOwnerAccountId('MLB1', 'A2', accounts, readItem, noSleep);
    expect(owner).toBeNull();
    expect(readItem).toHaveBeenCalledTimes(3);
  });

  it('sem conta atual (currentAccountId null), testa todas na ordem dada', async () => {
    const readItem = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const owner = await resolveTrueOwnerAccountId('MLB1', null, accounts, readItem, noSleep);
    expect(owner).toBe('A2');
  });
});

describe('verifyListingStoreOwnerML', () => {
  const productId = new Types.ObjectId();
  const storeIdWrong = new Types.ObjectId();
  const storeIdCorrect = new Types.ObjectId();
  const listingId = new Types.ObjectId();

  const makeRow = (over: Partial<VerifyListingRow> = {}): VerifyListingRow => ({
    _id: listingId,
    productId,
    externalId: 'MLB999',
    storeId: storeIdWrong,
    ...over,
  });

  const accounts: AccountCandidate[] = [
    { accountId: 'WRONG_ACC', accessToken: 'T_WRONG' },
    { accountId: 'CORRECT_ACC', accessToken: 'T_CORRECT' },
  ];

  function makeDeps(overrides: Partial<Parameters<typeof verifyListingStoreOwnerML>[0]> = {}) {
    const updateOne = jest.fn().mockResolvedValue({});
    const base = {
      listings: [makeRow()],
      allAccounts: accounts,
      resolveAccountId: jest.fn().mockResolvedValue('WRONG_ACC'),
      resolveStoreForAccount: jest.fn().mockResolvedValue(storeIdCorrect),
      hasConflictingStoreListing: jest.fn().mockResolvedValue(false),
      readItem: jest.fn(),
      listingModel: { updateOne },
      dryRun: false,
      ...overrides,
    };
    return { base, updateOne };
  }

  it('já correto: conta atual lê o item — não corrige, não chama updateOne', async () => {
    const { base, updateOne } = makeDeps({
      readItem: jest.fn().mockResolvedValue(true),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.alreadyCorrect).toBe(1);
    expect(summary.correctedToAnotherAccount).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('corrige quando outra conta é a dona real e há loja mapeada, sem conflito', async () => {
    const { base, updateOne } = makeDeps({
      readItem: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.correctedToAnotherAccount).toBe(1);
    expect(updateOne).toHaveBeenCalledWith({ _id: listingId }, { $set: { storeId: storeIdCorrect } });
  });

  it('dry-run: identifica a correção mas NÃO grava', async () => {
    const { base, updateOne } = makeDeps({
      dryRun: true,
      readItem: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.correctedToAnotherAccount).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('dono desconhecido (nenhuma conta lê): reporta, não corrige', async () => {
    const { base, updateOne } = makeDeps({
      readItem: jest.fn().mockResolvedValue(false),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.unknownOwner).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('conta correta identificada mas sem loja mapeada: reporta, não corrige', async () => {
    const { base, updateOne } = makeDeps({
      readItem: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      resolveStoreForAccount: jest.fn().mockResolvedValue(null),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.correctAccountNoStoreMapped).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('conflito com StoreListing real na loja atual: pula, não corrige', async () => {
    const { base, updateOne } = makeDeps({
      readItem: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      hasConflictingStoreListing: jest.fn().mockResolvedValue(true),
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.skippedConflictingStoreListing).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('regressão: nunca chama updateOne mais de uma vez por listing, mesmo em dry-run com múltiplos candidatos', async () => {
    const row2 = makeRow({ _id: new Types.ObjectId(), externalId: 'MLB888' });
    const { base, updateOne } = makeDeps({
      listings: [makeRow(), row2],
      readItem: jest
        .fn()
        .mockResolvedValueOnce(false).mockResolvedValueOnce(true) // listing 1: corrige
        .mockResolvedValueOnce(true), // listing 2: já correto (conta atual lê)
    });
    const summary = await verifyListingStoreOwnerML(base as any);
    expect(summary.correctedToAnotherAccount).toBe(1);
    expect(summary.alreadyCorrect).toBe(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
