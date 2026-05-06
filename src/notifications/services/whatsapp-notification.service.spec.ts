import { WhatsAppNotificationService } from './whatsapp-notification.service';

jest.mock('uuid', () => ({
  v4: () => 'mock-job-id',
}));

describe('WhatsAppNotificationService', () => {
  let service: WhatsAppNotificationService;

  beforeEach(() => {
    service = new WhatsAppNotificationService(
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue('') } as any,
      {} as any,
    );
  });

  it('inclui quantidade, preço unitário e total e não exibe linha de cupom', () => {
    const order = {
      createdAt: new Date('2026-04-04T11:31:00-03:00'),
      externalId: '2000015831839492',
      customer: { name: 'Roger Souza' },
      items: [
        {
          title: 'Cilindro Fechadura',
          quantity: 2,
          unitPrice: 200,
        },
      ],
    };

    const pricing = {
      marketplace: 'mercado livre',
      items: [{ title: 'Cilindro Fechadura', quantity: 2, unitPrice: 200 }],
      totals: {
        grossRevenue: 400,
        totalCommission: 68,
        totalFreight: 22.55,
        totalTaxes: 0,
        totalCostOfGoods: 0,
        totalGrossProfit: 0,
        totalNetProfit: 0,
        profitMarginPercent: 0,
      },
    } as any;

    const financial = {
      gross: 400,
      saleFee: 68,
      freight: 22.55,
      coupon: 60,
      taxes: 0,
      net: 309.45,
      costTotal: 0,
      grossProfit: 309.45,
      marginPct: 77.4,
      charges: [],
      taxDetails: [],
    };

    const message = (service as any).formatSaleMessage(order, pricing, financial);

    expect(message).toContain('Quantidade vendida: 2');
    expect(message).toContain('Preço unitário: R$\u00a0200,00');
    expect(message).toContain('Total itens: R$\u00a0400,00');
    expect(message).not.toContain('Cupom');
  });
});
