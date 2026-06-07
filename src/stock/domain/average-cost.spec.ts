import { weightedAverageCost } from './average-cost';

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
