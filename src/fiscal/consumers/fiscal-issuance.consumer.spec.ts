import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalIssuanceConsumer } from './fiscal-issuance.consumer';
import { FiscalService } from '../services/fiscal.service';
import { FISCAL_EVENTS } from '../events/fiscal.events';

describe('FiscalIssuanceConsumer', () => {
  let consumer: FiscalIssuanceConsumer;
  let fiscalService: { emitNFe: jest.Mock };
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    fiscalService = { emitNFe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalIssuanceConsumer,
        { provide: FiscalService, useValue: fiscalService },
        EventEmitter2,
      ],
    }).compile();

    consumer = moduleRef.get(FiscalIssuanceConsumer);
    eventEmitter = moduleRef.get(EventEmitter2);
  });

  it('processa a emissão com sucesso sem relançar', async () => {
    fiscalService.emitNFe.mockResolvedValue({ status: 'AUTHORIZED' });

    await consumer.handle({ orderId: 'order-1', overrides: {}, requestedAt: '' }, {});

    expect(fiscalService.emitNFe).toHaveBeenCalledWith('order-1', {});
  });

  it('erro de negócio (NotFoundException) não relança — não é recuperável por retry', async () => {
    fiscalService.emitNFe.mockRejectedValue(new NotFoundException('Loja sem canal fiscal'));

    await expect(consumer.handle({ orderId: 'order-1', overrides: {}, requestedAt: '' }, {})).resolves.toBeUndefined();
  });

  it('erro de negócio (BadRequestException) não relança', async () => {
    fiscalService.emitNFe.mockRejectedValue(new BadRequestException('Dados inválidos'));

    await expect(consumer.handle({ orderId: 'order-1', overrides: {}, requestedAt: '' }, {})).resolves.toBeUndefined();
  });

  it('erro de transporte relança para o RabbitMQ redeleta (NACK)', async () => {
    fiscalService.emitNFe.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(consumer.handle({ orderId: 'order-1', overrides: {}, requestedAt: '' }, {})).rejects.toThrow('ETIMEDOUT');
  });

  it('emite NFE_ISSUANCE_STUCK e não relança após esgotar tentativas', async () => {
    fiscalService.emitNFe.mockRejectedValue(new Error('ETIMEDOUT'));
    const listener = jest.fn();
    eventEmitter.on(FISCAL_EVENTS.NFE_ISSUANCE_STUCK, listener);

    const amqpMsg = { fields: { 'x-death': [{ count: 4 }] } }; // attempts = 4 + 1 = 5 = MAX

    await expect(
      consumer.handle({ orderId: 'order-1', overrides: {}, requestedAt: '' }, amqpMsg),
    ).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ orderId: 'order-1', attempts: 5 });
  });
});
