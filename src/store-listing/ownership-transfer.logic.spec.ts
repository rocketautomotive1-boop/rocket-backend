import { Types } from 'mongoose';
import { planOwnershipTransfer, mergeBalancesByCondition, TransferBalanceRow } from './ownership-transfer.logic';

function oid() {
  return new Types.ObjectId();
}

describe('planOwnershipTransfer', () => {
  const productId = oid();
  const fromStoreId = oid();
  const toStoreId = oid();

  it('noop quando não existe StoreListing de origem', () => {
    const plan = planOwnershipTransfer({
      productId,
      fromStoreId,
      toStoreId,
      sourceStoreListing: null,
      destinationStoreListing: null,
      sourceBalances: [],
    });
    expect(plan).toEqual({ kind: 'noop', reason: 'no_source_store_listing' });
  });

  it('repoint quando destino está livre (não existe StoreListing na loja correta)', () => {
    const source = { _id: oid(), storeId: fromStoreId };
    const plan = planOwnershipTransfer({
      productId,
      fromStoreId,
      toStoreId,
      sourceStoreListing: source,
      destinationStoreListing: null,
      sourceBalances: [{ _id: oid(), condition: 'new', onHand: 5, reserved: 0, boxId: null }],
    });
    expect(plan).toEqual({ kind: 'repoint', sourceStoreListingId: source._id });
  });

  it('merge quando destino já tem StoreListing próprio', () => {
    const source = { _id: oid(), storeId: fromStoreId };
    const destination = { _id: oid(), storeId: toStoreId };
    const plan = planOwnershipTransfer({
      productId,
      fromStoreId,
      toStoreId,
      sourceStoreListing: source,
      destinationStoreListing: destination,
      sourceBalances: [{ _id: oid(), condition: 'new', onHand: 3, reserved: 0, boxId: null }],
    });
    expect(plan).toEqual({
      kind: 'merge',
      sourceStoreListingId: source._id,
      destinationStoreListingId: destination._id,
    });
  });

  it('blocked quando algum balance de origem tem boxId preenchido — nunca move depósito físico silenciosamente', () => {
    const source = { _id: oid(), storeId: fromStoreId };
    const plan = planOwnershipTransfer({
      productId,
      fromStoreId,
      toStoreId,
      sourceStoreListing: source,
      destinationStoreListing: null,
      sourceBalances: [{ _id: oid(), condition: 'new', onHand: 5, reserved: 0, boxId: oid() }],
    });
    expect(plan).toEqual({ kind: 'blocked', reason: 'box_id_present', storeListingId: source._id });
  });

  it('blocked tem precedência sobre merge — boxId bloqueia mesmo com destino ocupado', () => {
    const source = { _id: oid(), storeId: fromStoreId };
    const destination = { _id: oid(), storeId: toStoreId };
    const plan = planOwnershipTransfer({
      productId,
      fromStoreId,
      toStoreId,
      sourceStoreListing: source,
      destinationStoreListing: destination,
      sourceBalances: [{ _id: oid(), condition: 'new', onHand: 5, reserved: 0, boxId: oid() }],
    });
    expect(plan.kind).toBe('blocked');
  });
});

describe('mergeBalancesByCondition', () => {
  it('soma onHand/reserved por condition entre origem e destino', () => {
    const source: TransferBalanceRow[] = [
      { _id: new Types.ObjectId(), condition: 'new', onHand: 5, reserved: 1, boxId: null },
    ];
    const destination: TransferBalanceRow[] = [
      { _id: new Types.ObjectId(), condition: 'new', onHand: 2, reserved: 0, boxId: null },
    ];

    const merged = mergeBalancesByCondition(source, destination);
    expect(merged).toEqual([{ condition: 'new', onHand: 7, reserved: 1 }]);
  });

  it('mantém conditions separadas quando origem e destino não compartilham nenhuma', () => {
    const source: TransferBalanceRow[] = [
      { _id: new Types.ObjectId(), condition: 'damaged', onHand: 2, reserved: 0, boxId: null },
    ];
    const destination: TransferBalanceRow[] = [
      { _id: new Types.ObjectId(), condition: 'new', onHand: 3, reserved: 0, boxId: null },
    ];

    const merged = mergeBalancesByCondition(source, destination);
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(
      expect.arrayContaining([
        { condition: 'damaged', onHand: 2, reserved: 0 },
        { condition: 'new', onHand: 3, reserved: 0 },
      ]),
    );
  });

  it('destino vazio — resultado é só a origem', () => {
    const source: TransferBalanceRow[] = [
      { _id: new Types.ObjectId(), condition: 'new', onHand: 4, reserved: 2, boxId: null },
    ];
    const merged = mergeBalancesByCondition(source, []);
    expect(merged).toEqual([{ condition: 'new', onHand: 4, reserved: 2 }]);
  });
});
