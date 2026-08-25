import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { FiscalMlAttachListener } from './fiscal-ml-attach.listener';
import { OrderModel } from '../../order/schemas/order.schema';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { FiscalNfeAuthorizedEvent } from '../events/fiscal.events';

describe('FiscalMlAttachListener', () => {
  let listener: FiscalMlAttachListener;
  let orderModel: { findById: jest.Mock };
  let registryService: { findOne: jest.Mock };
  let marketplaceOrderService: { attachFiscalDocument: jest.Mock };

  const event = new FiscalNfeAuthorizedEvent(
    'nfe-1', 'order-1', 'store-1', 'CHAVE123', 1, 42, '<xml/>', 'cliente@example.com', 'Cliente Teste',
  );

  beforeEach(async () => {
    orderModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          _id: 'order-1',
          externalId: 'MLB123',
          marketplaceId: 'mkt-1',
          packId: 'pack-1',
        }),
      }),
    };
    registryService = {
      findOne: jest.fn().mockResolvedValue({ _id: 'mkt-1', tag: 'mercadolivre' }),
    };
    marketplaceOrderService = {
      attachFiscalDocument: jest.fn().mockResolvedValue({ ok: true }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalMlAttachListener,
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: MarketplaceRegistryService, useValue: registryService },
        { provide: MarketplaceOrderService, useValue: marketplaceOrderService },
      ],
    }).compile();

    listener = moduleRef.get(FiscalMlAttachListener);
  });

  it('anexa a NFe ao pedido do Mercado Livre quando autorizada', async () => {
    await listener.onAuthorized(event);

    expect(orderModel.findById).toHaveBeenCalledWith('order-1');
    expect(registryService.findOne).toHaveBeenCalledWith('mkt-1');
    expect(marketplaceOrderService.attachFiscalDocument).toHaveBeenCalledWith(
      'MLB123',
      'mkt-1',
      '<xml/>',
      { packId: 'pack-1' },
    );
  });

  it('não anexa quando o marketplace do pedido não é Mercado Livre', async () => {
    registryService.findOne.mockResolvedValue({ _id: 'mkt-2', tag: 'shopee' });

    await listener.onAuthorized(event);

    expect(marketplaceOrderService.attachFiscalDocument).not.toHaveBeenCalled();
  });

  it('não anexa quando o evento não tem orderId (NFe avulsa)', async () => {
    const avulsaEvent = new FiscalNfeAuthorizedEvent(
      'nfe-2', null, 'store-1', 'CHAVE456', 1, 43, '<xml/>',
    );

    await listener.onAuthorized(avulsaEvent);

    expect(orderModel.findById).not.toHaveBeenCalled();
    expect(marketplaceOrderService.attachFiscalDocument).not.toHaveBeenCalled();
  });

  it('não propaga erro quando o anexo ao marketplace falha (best-effort)', async () => {
    marketplaceOrderService.attachFiscalDocument.mockRejectedValue(new Error('ML API indisponível'));

    await expect(listener.onAuthorized(event)).resolves.toBeUndefined();
  });

  it('não anexa quando o pedido não tem packId', async () => {
    orderModel.findById.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: 'order-1',
        externalId: 'MLB123',
        marketplaceId: 'mkt-1',
        packId: undefined,
      }),
    });

    await listener.onAuthorized(event);

    expect(marketplaceOrderService.attachFiscalDocument).toHaveBeenCalledWith(
      'MLB123',
      'mkt-1',
      '<xml/>',
      { packId: undefined },
    );
  });
});
