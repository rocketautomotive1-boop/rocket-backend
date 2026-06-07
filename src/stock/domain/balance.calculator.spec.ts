import { computeBalanceDelta } from './balance.calculator';
import { StockMovementType } from './movement-type';

describe('computeBalanceDelta', () => {
  it('inbound qty 5 → onHand +5, reserved 0', () => {
    expect(computeBalanceDelta(StockMovementType.INBOUND, 5)).toEqual({ onHand: 5, reserved: 0 });
  });
  it('outbound qty 3 → onHand -3', () => {
    expect(computeBalanceDelta(StockMovementType.OUTBOUND, 3)).toEqual({ onHand: -3, reserved: 0 });
  });
  it('reservation qty 2 → reserved +2', () => {
    expect(computeBalanceDelta(StockMovementType.RESERVATION, 2)).toEqual({ onHand: 0, reserved: 2 });
  });
  it('release qty 2 → reserved -2', () => {
    expect(computeBalanceDelta(StockMovementType.RELEASE, 2)).toEqual({ onHand: 0, reserved: -2 });
  });
  it('adjustment uses signed quantity', () => {
    expect(computeBalanceDelta(StockMovementType.ADJUSTMENT, -4)).toEqual({ onHand: -4, reserved: 0 });
  });
});
