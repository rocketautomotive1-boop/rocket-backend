import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { FiscalIssuanceRequestService } from './fiscal-issuance-request.service';
import { FiscalDocumentModel } from '../schemas/fiscal.schema';
import { OrderModel } from '../../order/schemas/order.schema';
import { OutboxRepository } from '../../outbox/outbox.repository';

describe('FiscalIssuanceRequestService', () => {
  const ORDER_ID = '6955b688dfe7143a30376c01';

  let service: FiscalIssuanceRequestService;
  let fiscalDocumentModel: any;
  let orderModel: any;
  let outbox: { enqueue: jest.Mock };

  beforeEach(async () => {
    fiscalDocumentModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => null }) }),
    };
    orderModel = {
      findOne: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => null }) }) }),
      findById: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ({ shipping: {} }) }) }) }),
    };
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalIssuanceRequestService,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: OutboxRepository, useValue: outbox },
      ],
    }).compile();

    service = moduleRef.get(FiscalIssuanceRequestService);
  });

  it('enfileira via outbox quando não há emissão em curso', async () => {
    const result = await service.request(ORDER_ID, { environment: 'PRODUCTION' });

    expect(result).toEqual({ status: 'QUEUED' });
    expect(outbox.enqueue).toHaveBeenCalledWith({
      exchange: 'rocket.fiscal',
      routingKey: 'nfe.emit.requested',
      payload: expect.objectContaining({ orderId: ORDER_ID }),
    });
  });

  it('não enfileira de novo quando já há FiscalDocument AUTHORIZED', async () => {
    fiscalDocumentModel.findOne.mockReturnValue({
      lean: () => ({ exec: async () => ({ _id: 'nfe-1', status: 'AUTHORIZED' }) }),
    });

    const result = await service.request(ORDER_ID, {});

    expect(result).toEqual({ status: 'ALREADY_ISSUED', nfeId: 'nfe-1' });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('não enfileira de novo quando já há FiscalDocument PROCESSING', async () => {
    fiscalDocumentModel.findOne.mockReturnValue({
      lean: () => ({ exec: async () => ({ _id: 'nfe-2', status: 'PROCESSING' }) }),
    });

    const result = await service.request(ORDER_ID, {});

    expect(result).toEqual({ status: 'ALREADY_ISSUED', nfeId: 'nfe-2' });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('resolve orderId por externalId quando não é um ObjectId válido', async () => {
    orderModel.findOne.mockReturnValue({
      select: () => ({ lean: () => ({ exec: async () => ({ _id: ORDER_ID }) }) }),
    });

    await service.request('MLB-12345', {});

    expect(orderModel.findOne).toHaveBeenCalledWith({ externalId: 'MLB-12345' });
    expect(outbox.enqueue).toHaveBeenCalled();
  });

  it('bloqueia emissão quando o shipment está em prazo de expedição (status/substatus ML: pending/buffered)', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    orderModel.findById.mockReturnValue({
      select: () => ({ lean: () => ({ exec: async () => ({ shipping: { status: 'pending', substatus: 'buffered', scheduledShippingDate: futureDate } }) }) }),
    });

    await expect(service.request(ORDER_ID, {})).rejects.toThrow(/prazo de expedição/i);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('permite emissão quando o shipment já saiu do buffer (status/substatus diferentes de pending/buffered)', async () => {
    orderModel.findById.mockReturnValue({
      select: () => ({ lean: () => ({ exec: async () => ({ shipping: { status: 'ready_to_ship', substatus: 'ready_to_print' } }) }) }),
    });

    const result = await service.request(ORDER_ID, {});

    expect(result).toEqual({ status: 'QUEUED' });
  });
});
