import { Types } from 'mongoose';
import {
  fixListingStoreOwner,
  resolveCorrectStoreId,
  OwnerFixListingRow,
} from '../../scripts/fix-listing-store-owner';

describe('resolveCorrectStoreId', () => {
  it('retorna null quando o listing não tem operador gravado', async () => {
    const lookup = jest.fn();
    const result = await resolveCorrectStoreId(null, lookup);
    expect(result).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('retorna o storeId do operador quando resolve', async () => {
    const storeId = new Types.ObjectId().toString();
    const lookup = jest.fn().mockResolvedValue(storeId);
    const result = await resolveCorrectStoreId('user-1', lookup);
    expect(result).toBe(storeId);
    expect(lookup).toHaveBeenCalledWith('user-1');
  });

  it('retorna null quando o operador não tem storeId configurado', async () => {
    const lookup = jest.fn().mockResolvedValue(null);
    const result = await resolveCorrectStoreId('user-1', lookup);
    expect(result).toBeNull();
  });

  it('retorna null quando o storeId do operador não é um ObjectId válido', async () => {
    const lookup = jest.fn().mockResolvedValue('not-an-objectid');
    const result = await resolveCorrectStoreId('user-1', lookup);
    expect(result).toBeNull();
  });
});

describe('fixListingStoreOwner', () => {
  const ROCKET = new Types.ObjectId().toString();
  const MAXESHOP = new Types.ObjectId().toString();

  function makeListing(overrides: Partial<OwnerFixListingRow> = {}): OwnerFixListingRow {
    return {
      _id: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      storeId: null,
      operatorUserId: null,
      ...overrides,
    };
  }

  function makeDeps(overrides: Partial<{
    userStoreIdLookup: jest.Mock;
    hasConflictingStoreListing: jest.Mock;
    listingModel: { updateOne: jest.Mock };
  }> = {}) {
    return {
      userStoreIdLookup: overrides.userStoreIdLookup ?? jest.fn().mockResolvedValue(MAXESHOP),
      hasConflictingStoreListing: overrides.hasConflictingStoreListing ?? jest.fn().mockResolvedValue(false),
      listingModel: overrides.listingModel ?? { updateOne: jest.fn() },
    };
  }

  it('regressão: listing sem storeId, com operador resolvendo — corrige (caso dos 329 originais)', async () => {
    const listing = makeListing({ storeId: null, operatorUserId: 'djalma' });
    const deps = makeDeps({ userStoreIdLookup: jest.fn().mockResolvedValue(MAXESHOP) });

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: false,
    });

    expect(deps.listingModel.updateOne).toHaveBeenCalledWith(
      { _id: listing._id },
      { $set: { storeId: new Types.ObjectId(MAXESHOP) } },
    );
    expect(summary.corrected).toBe(1);
    expect(summary.resolvedViaOperator).toBe(1);
  });

  it('regressão: listing com storeId=Rocket (fallback Fase 2) mas operador real é outra loja — corrige (caso dos 9080)', async () => {
    const listing = makeListing({ storeId: new Types.ObjectId(ROCKET), operatorUserId: 'gustavo' });
    const deps = makeDeps({
      userStoreIdLookup: jest.fn().mockResolvedValue(MAXESHOP),
      hasConflictingStoreListing: jest.fn().mockResolvedValue(false),
    });

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: false,
    });

    expect(deps.hasConflictingStoreListing).toHaveBeenCalledWith(listing.productId, listing.storeId);
    expect(deps.listingModel.updateOne).toHaveBeenCalledWith(
      { _id: listing._id },
      { $set: { storeId: new Types.ObjectId(MAXESHOP) } },
    );
    expect(summary.corrected).toBe(1);
  });

  it('pula (não corrige) quando já existe StoreListing real sob a loja atual — caso de conflito (os 2 produtos com estoque)', async () => {
    const listing = makeListing({ storeId: new Types.ObjectId(ROCKET), operatorUserId: 'gustavo' });
    const deps = makeDeps({
      userStoreIdLookup: jest.fn().mockResolvedValue(MAXESHOP),
      hasConflictingStoreListing: jest.fn().mockResolvedValue(true),
    });

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: false,
    });

    expect(deps.listingModel.updateOne).not.toHaveBeenCalled();
    expect(summary.skippedConflictingStoreListing).toBe(1);
    expect(summary.corrected).toBe(0);
  });

  it('não corrige quando o operador não resolve nenhuma loja (sem sinal)', async () => {
    const listing = makeListing({ storeId: null, operatorUserId: null });
    const deps = makeDeps();

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: false,
    });

    expect(deps.listingModel.updateOne).not.toHaveBeenCalled();
    expect(summary.unresolvedNoSignal).toBe(1);
  });

  it('não corrige quando o storeId atual já é o correto', async () => {
    const listing = makeListing({ storeId: new Types.ObjectId(MAXESHOP), operatorUserId: 'gustavo' });
    const deps = makeDeps({ userStoreIdLookup: jest.fn().mockResolvedValue(MAXESHOP) });

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: false,
    });

    expect(deps.listingModel.updateOne).not.toHaveBeenCalled();
    expect(deps.hasConflictingStoreListing).not.toHaveBeenCalled();
    expect(summary.alreadyCorrect).toBe(1);
  });

  it('dry-run: não escreve nada, mas conta corretamente', async () => {
    const listing = makeListing({ storeId: null, operatorUserId: 'djalma' });
    const deps = makeDeps({ userStoreIdLookup: jest.fn().mockResolvedValue(MAXESHOP) });

    const summary = await fixListingStoreOwner({
      listings: [listing],
      ...deps,
      dryRun: true,
    });

    expect(deps.listingModel.updateOne).not.toHaveBeenCalled();
    expect(summary.corrected).toBe(1);
  });
});
