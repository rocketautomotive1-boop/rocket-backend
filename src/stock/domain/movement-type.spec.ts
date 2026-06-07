import { StockMovementType, MOVEMENT_EFFECT } from './movement-type';

describe('MOVEMENT_EFFECT', () => {
  it('inbound adds onHand, no reserved', () => {
    expect(MOVEMENT_EFFECT[StockMovementType.INBOUND]).toEqual({ onHand: 1, reserved: 0, movesLocation: false });
  });
  it('outbound subtracts onHand', () => {
    expect(MOVEMENT_EFFECT[StockMovementType.OUTBOUND].onHand).toBe(-1);
  });
  it('reservation only affects reserved (+1)', () => {
    expect(MOVEMENT_EFFECT[StockMovementType.RESERVATION]).toEqual({ onHand: 0, reserved: 1, movesLocation: false });
  });
  it('release frees reserved (-1)', () => {
    expect(MOVEMENT_EFFECT[StockMovementType.RELEASE].reserved).toBe(-1);
  });
  it('transfer moves location, net zero', () => {
    expect(MOVEMENT_EFFECT[StockMovementType.TRANSFER]).toEqual({ onHand: 0, reserved: 0, movesLocation: true });
  });
  it('every enum value has an effect entry', () => {
    for (const t of Object.values(StockMovementType)) {
      expect(MOVEMENT_EFFECT[t]).toBeDefined();
    }
  });
});
