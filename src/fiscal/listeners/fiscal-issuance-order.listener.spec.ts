import { Test } from '@nestjs/testing';
import { FiscalIssuanceOrderListener } from './fiscal-issuance-order.listener';
import { FiscalIssuanceRequestService } from '../services/fiscal-issuance-request.service';
import { OrderReadyToShipEvent } from '../../order/events/order.events';

describe('FiscalIssuanceOrderListener', () => {
  let listener: FiscalIssuanceOrderListener;
  let issuanceRequest: { request: jest.Mock };

  beforeEach(async () => {
    issuanceRequest = { request: jest.fn().mockResolvedValue({ status: 'QUEUED' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalIssuanceOrderListener,
        { provide: FiscalIssuanceRequestService, useValue: issuanceRequest },
      ],
    }).compile();

    listener = moduleRef.get(FiscalIssuanceOrderListener);
  });

  it('chama request() ao receber READY_TO_SHIP', async () => {
    const event = new OrderReadyToShipEvent('order-1', 'MLB-1', 'mp1', 'mercado_livre', 'acc1', ['p1']);

    await listener.onReadyToShip(event);

    expect(issuanceRequest.request).toHaveBeenCalledWith('order-1', { environment: 'PRODUCTION' });
  });

  it('captura erro de resolução fiscal e não propaga', async () => {
    issuanceRequest.request.mockRejectedValue(new Error('Loja sem canal fiscal'));
    const event = new OrderReadyToShipEvent('order-1', 'MLB-1', 'mp1', 'mercado_livre', 'acc1', ['p1']);

    await expect(listener.onReadyToShip(event)).resolves.toBeUndefined();
  });
});
