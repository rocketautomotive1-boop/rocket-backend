import { computeDivergences } from './divergence.calculator';
import { StockMovementType } from '../../stock-shared/movement-type';

describe('computeDivergences', () => {
  it('sem drift: soma do ledger bate com onHand agregado', () => {
    const divergences = computeDivergences(
      [
        { storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 5 },
        { storeListingId: 's1', condition: 'new', type: StockMovementType.OUTBOUND, quantity: 2 },
      ],
      [{ storeListingId: 's1', condition: 'new', onHand: 3 }],
    );
    expect(divergences).toEqual([]);
  });

  it('drift de quantidade: expected != actual', () => {
    const divergences = computeDivergences(
      [{ storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 5 }],
      [{ storeListingId: 's1', condition: 'new', onHand: 3 }],
    );
    expect(divergences).toEqual([
      { storeListingId: 's1', condition: 'new', expected: 5, actual: 3, delta: 2 },
    ]);
  });

  it('par presente só no ledger (balance ausente)', () => {
    const divergences = computeDivergences(
      [{ storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 4 }],
      [],
    );
    expect(divergences).toEqual([
      { storeListingId: 's1', condition: 'new', expected: 4, actual: 0, delta: 4 },
    ]);
  });

  it('par presente só no balance (ledger ausente)', () => {
    const divergences = computeDivergences(
      [],
      [{ storeListingId: 's1', condition: 'new', onHand: 7 }],
    );
    expect(divergences).toEqual([
      { storeListingId: 's1', condition: 'new', expected: 0, actual: 7, delta: -7 },
    ]);
  });

  it('agrega múltiplos boxId do mesmo (storeListingId, condition)', () => {
    const divergences = computeDivergences(
      [{ storeListingId: 's1', condition: 'used', type: StockMovementType.INBOUND, quantity: 10 }],
      [
        { storeListingId: 's1', condition: 'used', onHand: 4 },
        { storeListingId: 's1', condition: 'used', onHand: 6 },
      ],
    );
    expect(divergences).toEqual([]);
  });

  it('ajuste usa quantidade assinada', () => {
    const divergences = computeDivergences(
      [
        { storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 10 },
        { storeListingId: 's1', condition: 'new', type: StockMovementType.ADJUSTMENT, quantity: -3 },
      ],
      [{ storeListingId: 's1', condition: 'new', onHand: 7 }],
    );
    expect(divergences).toEqual([]);
  });

  it('não mistura pares diferentes de (storeListingId, condition)', () => {
    const divergences = computeDivergences(
      [
        { storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 5 },
        { storeListingId: 's2', condition: 'used', type: StockMovementType.INBOUND, quantity: 8 },
      ],
      [
        { storeListingId: 's1', condition: 'new', onHand: 5 },
        { storeListingId: 's2', condition: 'used', onHand: 1 },
      ],
    );
    expect(divergences).toEqual([
      { storeListingId: 's2', condition: 'used', expected: 8, actual: 1, delta: 7 },
    ]);
  });
});
