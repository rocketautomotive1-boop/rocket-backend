import { MlFeesAdapter } from './ml-fees.adapter';

describe('MlFeesAdapter.parseCommission', () => {
  it('extrai sale_fee_amount e percentage_fee (objeto único)', () => {
    const out = MlFeesAdapter.parseCommission({
      sale_fee_amount: 12,
      sale_fee_details: { fixed_fee: 0, percentage_fee: 12, gross_amount: 12 },
      listing_type_id: 'gold_special',
    });
    expect(out.saleFeeAmount).toBe(12);
    expect(out.commissionRate).toBeCloseTo(0.12, 4);
    expect(out.fixedFee).toBe(0);
    expect(out.listingTypeId).toBe('gold_special');
  });

  it('aceita array e escolhe pelo listingTypeId', () => {
    const out = MlFeesAdapter.parseCommission([
      { sale_fee_amount: 16, sale_fee_details: { fixed_fee: 0, percentage_fee: 16 }, listing_type_id: 'gold_pro' },
      { sale_fee_amount: 12, sale_fee_details: { fixed_fee: 0, percentage_fee: 12 }, listing_type_id: 'gold_special' },
    ], 'gold_special');
    expect(out.saleFeeAmount).toBe(12);
  });
});

describe('MlFeesAdapter.parseShipping', () => {
  it('usa promoted_amount quando presente', () => {
    expect(MlFeesAdapter.parseShipping({ coverage: { all_country: { list_cost: 0.5, discount: { promoted_amount: 8.5 } } } })).toBeCloseTo(8.5, 2);
  });
  it('cai para list_cost sem promoted_amount', () => {
    expect(MlFeesAdapter.parseShipping({ coverage: { all_country: { list_cost: 11 } } })).toBe(11);
  });
  it('retorna 0 sem coverage', () => {
    expect(MlFeesAdapter.parseShipping({})).toBe(0);
  });
});
