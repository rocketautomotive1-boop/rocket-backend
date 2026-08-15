import { Types } from 'mongoose';
import { planLotDedupe, LotRow, BalanceRow, MovementRow } from '../../scripts/dedupe-store-listing-stock-lots';

describe('planLotDedupe', () => {
  const STORE_LISTING_ID = new Types.ObjectId();

  it('devolve plano vazio quando cada (storeListingId, condition) tem no máximo 1 lote', () => {
    const lots: LotRow[] = [
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-13') },
    ];
    const plan = planLotDedupe({ lots, balances: [], movements: [] });
    expect(plan.groups).toHaveLength(0);
  });

  it('reproduz o caso de produção: lote migrado (originalLotId setado) + lote orgânico (sem originalLotId) para o mesmo (storeListingId, condition) — mantém o migrado, remove o orgânico', () => {
    const migratedLotId = new Types.ObjectId();
    const organicLotId = new Types.ObjectId();

    const lots: LotRow[] = [
      { _id: organicLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T12:40:03Z') },
      { _id: migratedLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: new Types.ObjectId(), createdAt: new Date('2026-08-14T14:57:15Z') },
    ];
    const balances: BalanceRow[] = [
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, lotId: organicLotId, boxId: null, onHand: 1, reserved: 0, originalBalanceId: undefined },
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, lotId: migratedLotId, boxId: null, onHand: 1, reserved: 0, originalBalanceId: new Types.ObjectId() },
    ];
    const movements: MovementRow[] = [
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, lotId: organicLotId, quantity: 1 },
    ];

    const plan = planLotDedupe({ lots, balances, movements });

    expect(plan.groups).toHaveLength(1);
    const group = plan.groups[0];
    expect(group.keepLotId.equals(migratedLotId)).toBe(true);
    expect(group.removeLotIds.map(String)).toEqual([String(organicLotId)]);
    expect(group.balancePlan).toHaveLength(1);
    expect(group.balancePlan[0].boxId).toBeNull();
    expect(group.balancePlan[0].onHand).toBe(2);
    expect(group.balancePlan[0].reserved).toBe(0);
    expect(group.balancePlan[0].keepBalanceId).toEqual(expect.anything());
    expect(group.balancePlan[0].removeBalanceIds).toHaveLength(1);
    expect(group.movementsToRepoint.map(String)).toEqual([String(movements[0]._id)]);
  });

  it('prefere o lote MIGRADO (originalLotId setado) como sobrevivente mesmo quando foi criado depois', () => {
    const organicLotId = new Types.ObjectId();
    const migratedLotId = new Types.ObjectId();
    const lots: LotRow[] = [
      { _id: migratedLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: new Types.ObjectId(), createdAt: new Date('2026-08-13T13:00:00Z') },
      { _id: organicLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T23:46:00Z') },
    ];
    const plan = planLotDedupe({ lots, balances: [], movements: [] });
    expect(plan.groups[0].keepLotId.equals(migratedLotId)).toBe(true);
  });

  it('quando nenhum lote do grupo tem originalLotId, mantém o mais antigo (createdAt) por determinismo', () => {
    const olderId = new Types.ObjectId();
    const newerId = new Types.ObjectId();
    const lots: LotRow[] = [
      { _id: newerId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T21:00:00Z') },
      { _id: olderId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-13T13:00:00Z') },
    ];
    const plan = planLotDedupe({ lots, balances: [], movements: [] });
    expect(plan.groups[0].keepLotId.equals(olderId)).toBe(true);
  });

  it('soma onHand/reserved de balances duplicados por boxId dentro do lote sobrevivente, mantendo o balance mais antigo como destino', () => {
    const migratedLotId = new Types.ObjectId();
    const organicLotId = new Types.ObjectId();
    const keepBalanceId = new Types.ObjectId();
    const removeBalanceId = new Types.ObjectId();

    const lots: LotRow[] = [
      { _id: migratedLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: new Types.ObjectId(), createdAt: new Date('2026-08-13T13:00:00Z') },
      { _id: organicLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T18:29:00Z') },
    ];
    const balances: BalanceRow[] = [
      { _id: keepBalanceId, storeListingId: STORE_LISTING_ID, lotId: migratedLotId, boxId: null, onHand: 4, reserved: 1, originalBalanceId: new Types.ObjectId(), createdAt: new Date('2026-08-13T13:00:00Z') },
      { _id: removeBalanceId, storeListingId: STORE_LISTING_ID, lotId: organicLotId, boxId: null, onHand: 2, reserved: 0, originalBalanceId: undefined, createdAt: new Date('2026-08-14T18:29:00Z') },
    ];

    const plan = planLotDedupe({ lots, balances, movements: [] });
    const balancePlan = plan.groups[0].balancePlan[0];
    expect(balancePlan.keepBalanceId.equals(keepBalanceId)).toBe(true);
    expect(balancePlan.removeBalanceIds.map(String)).toEqual([String(removeBalanceId)]);
    expect(balancePlan.onHand).toBe(6);
    expect(balancePlan.reserved).toBe(1);
  });

  it('trata boxId diferentes como saldos independentes (não soma entre boxes distintas)', () => {
    const migratedLotId = new Types.ObjectId();
    const organicLotId = new Types.ObjectId();
    const boxA = new Types.ObjectId();
    const boxB = new Types.ObjectId();

    const lots: LotRow[] = [
      { _id: migratedLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: new Types.ObjectId(), createdAt: new Date('2026-08-13T13:00:00Z') },
      { _id: organicLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T18:29:00Z') },
    ];
    const balances: BalanceRow[] = [
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, lotId: migratedLotId, boxId: boxA, onHand: 3, reserved: 0, originalBalanceId: new Types.ObjectId() },
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, lotId: organicLotId, boxId: boxB, onHand: 5, reserved: 0, originalBalanceId: undefined },
    ];

    const plan = planLotDedupe({ lots, balances, movements: [] });
    expect(plan.groups[0].balancePlan).toHaveLength(2);
    const byBox = new Map(plan.groups[0].balancePlan.map((b) => [String(b.boxId), b]));
    expect(byBox.get(String(boxA))!.onHand).toBe(3);
    expect(byBox.get(String(boxB))!.onHand).toBe(5);
  });

  it('só reponta movements que apontam pros lotes REMOVIDOS do grupo (não toca movements do lote mantido)', () => {
    const migratedLotId = new Types.ObjectId();
    const organicLotId = new Types.ObjectId();
    const lots: LotRow[] = [
      { _id: migratedLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: new Types.ObjectId(), createdAt: new Date('2026-08-13T13:00:00Z') },
      { _id: organicLotId, storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date('2026-08-14T18:29:00Z') },
    ];
    const movOnKept = new Types.ObjectId();
    const movOnRemoved = new Types.ObjectId();
    const movements: MovementRow[] = [
      { _id: movOnKept, storeListingId: STORE_LISTING_ID, lotId: migratedLotId, quantity: 1 },
      { _id: movOnRemoved, storeListingId: STORE_LISTING_ID, lotId: organicLotId, quantity: 1 },
    ];

    const plan = planLotDedupe({ lots, balances: [], movements });
    expect(plan.groups[0].movementsToRepoint.map(String)).toEqual([String(movOnRemoved)]);
  });

  it('ignora storeListingId diferentes ao agrupar (nenhum cross-talk entre lojas)', () => {
    const otherStoreListing = new Types.ObjectId();
    const lots: LotRow[] = [
      { _id: new Types.ObjectId(), storeListingId: STORE_LISTING_ID, condition: 'new', originalLotId: undefined, createdAt: new Date() },
      { _id: new Types.ObjectId(), storeListingId: otherStoreListing, condition: 'new', originalLotId: undefined, createdAt: new Date() },
    ];
    const plan = planLotDedupe({ lots, balances: [], movements: [] });
    expect(plan.groups).toHaveLength(0);
  });
});
