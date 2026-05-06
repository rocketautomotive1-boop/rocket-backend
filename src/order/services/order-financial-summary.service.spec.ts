import { OrderFinancialSummaryService } from './order-financial-summary.service';
import { OrderMarketplaceDetailsService } from './order-marketplace-details.service';

describe('OrderFinancialSummaryService', () => {
  let service: OrderFinancialSummaryService;
  let marketplaceDetailsService: jest.Mocked<OrderMarketplaceDetailsService>;

  beforeEach(() => {
    marketplaceDetailsService = {
      getDetails: jest.fn(),
      getMlBillingDetails: jest.fn(),
    } as unknown as jest.Mocked<OrderMarketplaceDetailsService>;

    service = new OrderFinancialSummaryService(marketplaceDetailsService);
  });

  it('corrige cupom do ML quando total já inclui preço cheio do produto', async () => {
    marketplaceDetailsService.getDetails.mockResolvedValue({
      financial: {
        grossAmount: 340,
        saleFee: 68,
        freightCost: 22.55,
        couponAmount: 60,
        taxesAmount: 0,
        netAmount: 189.45,
        charges: [],
      },
      shipping: {
        listCost: 22.55,
      },
    } as any);
    marketplaceDetailsService.getMlBillingDetails.mockResolvedValue({ supported: true, data: null } as any);

    const order = { _id: 'order-1', totalAmount: 400, payment: {} };
    const pricing = {
      marketplace: 'mercadolivre',
      totals: {
        grossRevenue: 400,
        totalCommission: 68,
        totalFreight: 22.55,
        totalTaxes: 0,
        totalCostOfGoods: 0,
      },
    } as any;

    const result = await service.getFinancialSummary(order, pricing);

    expect(result.gross).toBe(400);
    expect(result.coupon).toBe(0);
    expect(result.net).toBeCloseTo(309.45, 2);
  });

  it('corrige comissão unitária do ML para comissão total quando quantidade > 1', async () => {
    marketplaceDetailsService.getDetails.mockResolvedValue({
      financial: {
        grossAmount: 56,
        saleFee: 1.19,
        freightCost: 28,
        couponAmount: 0,
        taxesAmount: 0,
        netAmount: 26.81,
        charges: [],
      },
      shipping: {
        listCost: 28,
      },
    } as any);
    marketplaceDetailsService.getMlBillingDetails.mockResolvedValue({ supported: true, data: null } as any);

    const order = {
      _id: 'order-2',
      totalAmount: 56,
      payment: {},
      items: [{ quantity: 8 }],
    };
    const pricing = {
      marketplace: 'mercadolivre',
      totals: {
        grossRevenue: 56,
        totalCommission: 9.52,
        totalFreight: 28,
        totalTaxes: 0,
        totalCostOfGoods: 0,
      },
    } as any;

    const result = await service.getFinancialSummary(order, pricing);

    expect(result.saleFee).toBeCloseTo(9.52, 2);
    expect(result.net).toBeCloseTo(18.48, 2);
  });
});
