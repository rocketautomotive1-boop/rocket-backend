import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { forwardRef } from '@nestjs/common';
import { MarketplaceOrderService } from './marketplace-order.service';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { OrderModel } from '../../order/schemas/order.schema';
import { ProductService } from '../../product/product.service';
import { ProductRepository } from '../../product/product.repository';
import { IgnoredOrderModel } from '../schemas/ignored-order.schema';
import { ListingService } from '../../listing/listing.service';
import { STORE_PORT } from '../../store/ports/store.port';

describe('MarketplaceOrderService.attachFiscalDocument', () => {
  let service: MarketplaceOrderService;
  let orderModel: { updateOne: jest.Mock };
  let registryService: { findOne: jest.Mock };
  let adapterRegistry: { getOrderAdapter: jest.Mock };

  beforeEach(async () => {
    orderModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    registryService = { findOne: jest.fn().mockResolvedValue({ _id: 'mkt-1', name: 'mercadolivre' }) };
    adapterRegistry = { getOrderAdapter: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceOrderService,
        { provide: MarketplaceRegistryService, useValue: registryService },
        { provide: MarketplaceAdapterRegistry, useValue: adapterRegistry },
        { provide: MarketplaceAuthService, useValue: {} },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: ProductService, useValue: {} },
        { provide: ProductRepository, useValue: {} },
        { provide: getModelToken(IgnoredOrderModel.name), useValue: {} },
        { provide: ListingService, useValue: {} },
        { provide: STORE_PORT, useValue: {} },
      ],
    })
      .overrideProvider(forwardRef(() => ProductService) as any)
      .useValue({})
      .compile();

    service = moduleRef.get(MarketplaceOrderService);
  });

  it('grava fiscalAttachedAt no pedido quando o upload da NFe ao marketplace tem sucesso', async () => {
    adapterRegistry.getOrderAdapter.mockReturnValue({
      uploadInvoice: jest.fn().mockResolvedValue({ ok: true }),
    });

    await service.attachFiscalDocument('MLB123', 'mkt-1', '<xml/>', {});

    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { externalId: 'MLB123' },
      expect.objectContaining({
        $set: expect.objectContaining({ fiscalAttachedAt: expect.any(Date) }),
        $unset: expect.objectContaining({ fiscalAttachError: '' }),
      }),
    );
  });

  it('grava fiscalAttachError no pedido quando o upload da NFe ao marketplace falha', async () => {
    adapterRegistry.getOrderAdapter.mockReturnValue({
      uploadInvoice: jest.fn().mockRejectedValue(new Error('ML API indisponível')),
    });

    await expect(
      service.attachFiscalDocument('MLB123', 'mkt-1', '<xml/>', {}),
    ).rejects.toThrow();

    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { externalId: 'MLB123' },
      expect.objectContaining({
        $set: expect.objectContaining({ fiscalAttachError: expect.stringContaining('ML API indisponível') }),
      }),
    );
  });
});
