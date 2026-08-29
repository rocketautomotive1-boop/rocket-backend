import { computeBalanceDelta, weightedAverageCost } from './balance-math';
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

describe('weightedAverageCost', () => {
  it('first inbound sets the cost', () => {
    expect(weightedAverageCost(0, 0, 10, 2)).toBeCloseTo(2);
  });
  it('blends existing and new lot', () => {
    // 10 units @2 + 10 units @4 = 20 units @3
    expect(weightedAverageCost(10, 2, 10, 4)).toBeCloseTo(3);
  });
  it('zero incoming returns existing avg', () => {
    expect(weightedAverageCost(5, 7, 0, 99)).toBeCloseTo(7);
  });
});
