import { MercadoLivrePricingAdapter } from './mercado-livre-pricing.adapter';

describe('MercadoLivrePricingAdapter (pure math)', () => {
  // http is unused by the pure methods; pass a stub.
  const adapter = new MercadoLivrePricingAdapter({ get: jest.fn() } as any);

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

  describe('getListingPrices (ML proxy via MlHttpClient)', () => {
    const http = { get: jest.fn() };
    const proxyAdapter = new MercadoLivrePricingAdapter(http as any);

    afterEach(() => http.get.mockReset());

    it('calls /sites/MLB/listing_prices with price and category (auth/token no client)', async () => {
      http.get.mockResolvedValue([{ listing_type_id: 'gold_special' }]);

      const out = await proxyAdapter.getListingPrices({ price: 100, categoryId: 'MLB1403' });

      const [path, ctx, query] = http.get.mock.calls[0];
      expect(path).toBe('/sites/MLB/listing_prices');
      expect(ctx).toEqual(expect.objectContaining({ context: 'getListingPrices' }));
      expect(query).toEqual({ price: 100, category_id: 'MLB1403' });
      expect(out).toEqual([{ listing_type_id: 'gold_special' }]);
    });

    it('omits category_id when not provided and passes listing_type_id when given', async () => {
      http.get.mockResolvedValue([]);
      await proxyAdapter.getListingPrices({ price: 50, listingTypeId: 'gold_pro' });
      const [, , query] = http.get.mock.calls[0];
      expect(query).toEqual({ price: 50, listing_type_id: 'gold_pro' });
    });

    it('normalizes a single-object response into an array', async () => {
      http.get.mockResolvedValue({ listing_type_id: 'gold_special' });
      const out = await proxyAdapter.getListingPrices({ price: 100, listingTypeId: 'gold_special' });
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(1);
    });
  });

  describe('suggestPriceForMargin', () => {
    const adapter = new MercadoLivrePricingAdapter({ getValidToken: jest.fn() } as any);

    // Fee model for the test: 15% of price, no fixed fee.
    const feeLookup = async (price: number) => price * 0.15;

    it('finds a price whose margin matches the target (cost 60, target 20%)', async () => {
      // netProfit = price - 60 - 0.15*price = 0.85*price - 60
      // margin = (0.85*price - 60)/price = 0.85 - 60/price = 0.20  => price = 60/0.65 ≈ 92.31
      const r = await adapter.suggestPriceForMargin({
        cost: 60,
        targetMargin: 0.2,
        feeLookup,
        minPrice: 60,
        maxPrice: 1000,
      });
      expect(r.suggestedPrice).toBeGreaterThan(92);
      expect(r.suggestedPrice).toBeLessThan(93);
      expect(r.converged).toBe(true);

      const fee = await feeLookup(r.suggestedPrice);
      const margin = (r.suggestedPrice - 60 - fee) / r.suggestedPrice;
      expect(margin).toBeCloseTo(0.2, 2);
    });

    it('returns null when the target margin is unreachable within bounds', async () => {
      const r = await adapter.suggestPriceForMargin({
        cost: 60,
        targetMargin: 0.95, // needs price→∞ with this fee model
        feeLookup,
        minPrice: 60,
        maxPrice: 200,
      });
      expect(r.suggestedPrice).toBeNull();
      expect(r.converged).toBe(false);
    });
  });
});
