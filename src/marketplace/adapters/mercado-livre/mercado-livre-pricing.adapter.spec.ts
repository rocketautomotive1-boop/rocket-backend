import { MercadoLivrePricingAdapter } from './mercado-livre-pricing.adapter';

describe('MercadoLivrePricingAdapter (pure math)', () => {
  // authAdapter is unused by the pure methods; pass a stub.
  const adapter = new MercadoLivrePricingAdapter({ getValidToken: jest.fn() } as any);

  describe('computeNetProfit', () => {
    it('subtracts cost and sale fee from price and computes margin', () => {
      const r = adapter.computeNetProfit(100, 60, 16.5);
      expect(r.netProfit).toBeCloseTo(23.5, 2);
      expect(r.marginPct).toBeCloseTo(0.235, 4);
    });

    it('treats missing cost as zero', () => {
      const r = adapter.computeNetProfit(100, undefined, 16.5);
      expect(r.netProfit).toBeCloseTo(83.5, 2);
    });

    it('returns marginPct 0 and netProfit 0 when price is 0', () => {
      const r = adapter.computeNetProfit(0, 0, 0);
      expect(r.marginPct).toBe(0);
      expect(r.netProfit).toBe(0);
    });
  });

  describe('compareListingTypes', () => {
    // Fixture shaped like ML /sites/MLB/listing_prices response (price+category filter)
    const raw = [
      {
        currency_id: 'BRL',
        listing_type_id: 'gold_pro',
        listing_type_name: 'Premium',
        sale_fee_amount: 38.5,
        sale_fee_details: { percentage_fee: 38.5, fixed_fee: 0 },
      },
      {
        currency_id: 'BRL',
        listing_type_id: 'gold_special',
        listing_type_name: 'Clássico',
        sale_fee_amount: 15.5,
        sale_fee_details: { percentage_fee: 15.5, fixed_fee: 0 },
      },
      {
        currency_id: 'BRL',
        listing_type_id: 'free',
        listing_type_name: 'Gratuita',
        sale_fee_amount: 0,
        sale_fee_details: { percentage_fee: 0, fixed_fee: 0 },
      },
    ];

    it('keeps only gold_special and gold_pro, ordered classic then premium', () => {
      const out = adapter.compareListingTypes(raw, 100, 60);
      expect(out.map((t) => t.listingTypeId)).toEqual(['gold_special', 'gold_pro']);
    });

    it('maps fee fields and computes net profit per type', () => {
      const out = adapter.compareListingTypes(raw, 100, 60);
      const classic = out.find((t) => t.listingTypeId === 'gold_special')!;
      expect(classic.name).toBe('Clássico');
      expect(classic.saleFeeAmount).toBe(15.5);
      expect(classic.percentageFee).toBe(15.5);
      expect(classic.fixedFee).toBe(0);
      expect(classic.netProfit).toBeCloseTo(24.5, 2); // 100 - 60 - 15.5
      expect(classic.marginPct).toBeCloseTo(0.245, 4);
      const premium = out.find((t) => t.listingTypeId === 'gold_pro')!;
      expect(premium.name).toBe('Premium');
      expect(premium.saleFeeAmount).toBe(38.5);
      expect(premium.netProfit).toBeCloseTo(1.5, 2); // 100 - 60 - 38.5
      expect(premium.marginPct).toBeCloseTo(0.015, 4);
    });

    it('returns empty array when neither relevant type is present', () => {
      expect(adapter.compareListingTypes([raw[2]], 100, 60)).toEqual([]);
    });

    it('treats a missing sale_fee_amount as zero (no NaN)', () => {
      const rawMissing = [
        { currency_id: 'BRL', listing_type_id: 'gold_special', listing_type_name: 'Clássico', sale_fee_details: { percentage_fee: 0, fixed_fee: 0 } },
      ] as any;
      const out = adapter.compareListingTypes(rawMissing, 100, 60);
      expect(out[0].saleFeeAmount).toBe(0);
      expect(out[0].netProfit).toBe(40);
      expect(Number.isNaN(out[0].netProfit)).toBe(false);
    });
  });
});
