// uuid uses ESM exports — mock it so ts-jest doesn't choke on the ESM syntax
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

import { WhatsAppNotificationListener } from './whatsapp-notification.listener';

describe('WhatsAppNotificationListener.handlePricingCalculated', () => {
  function makeSut() {
    const orderModel = {
      findById: jest.fn(() => ({
        exec: () =>
          Promise.resolve({
            _id: 'o1',
            notificationStatus: {},
            createdAt: new Date(),
          }),
      })),
      findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
    };

    const whatsappService = {
      sendSaleNotification: jest.fn().mockResolvedValue(undefined),
    };

    const financialSummaryService = {
      getFinancialSummary: jest.fn().mockResolvedValue({
        gross: 0,
        saleFee: 0,
        freight: 0,
        taxes: 0,
        coupon: 0,
        net: 0,
        costTotal: 0,
        grossProfit: 0,
        marginPct: 0,
      }),
    };

    // Constructor order: orderModel, whatsappService, financialSummaryService
    const sut = new WhatsAppNotificationListener(
      orderModel as any,
      whatsappService as any,
      financialSummaryService as any,
    );

    return { sut, orderModel, whatsappService, financialSummaryService };
  }

  it('NÃO notifica nem chama billing quando triggeredBy=reconcile', async () => {
    const { sut, whatsappService, financialSummaryService } = makeSut();

    await sut.handlePricingCalculated({
      orderId: 'o1',
      externalId: 'EXT-1',
      pricing: {},
      triggeredBy: 'reconcile',
    } as any);

    expect(financialSummaryService.getFinancialSummary).not.toHaveBeenCalled();
    expect(whatsappService.sendSaleNotification).not.toHaveBeenCalled();
  });

  it('notifica normalmente quando triggeredBy=sync (ordem recente)', async () => {
    const { sut, whatsappService } = makeSut();

    await sut.handlePricingCalculated({
      orderId: 'o1',
      externalId: 'EXT-1',
      pricing: {},
      triggeredBy: 'sync',
    } as any);

    expect(whatsappService.sendSaleNotification).toHaveBeenCalled();
  });
});
