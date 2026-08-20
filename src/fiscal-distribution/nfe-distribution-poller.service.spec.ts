import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NfeDistributionPoller } from './nfe-distribution-poller.service';
import { LegalEntityModel } from '../legal-entity/schemas/legal-entity.schema';
import { NfeDistributionEventModel, NfeDistributionCursorModel } from './schemas/nfe-distribution-event.schema';
import { NfeDistribuicaoClient } from './services/nfe-distribuicao.client';
import { NfeManifestacaoClient } from './services/nfe-manifestacao.client';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';

describe('NfeDistributionPoller.pollOnce', () => {
  let poller: NfeDistributionPoller;
  let legalEntityModel: any;
  let eventModel: any;
  let cursorModel: any;
  let distribuicaoClient: { consultar: jest.Mock };
  let manifestacaoClient: { manifest: jest.Mock };
  let eventEmitter: EventEmitter2;

  const legalEntity = {
    _id: 'legal1', cnpj: '00000000000191', companyName: 'Rocket', certificatePfx: 'pfx',
    certificatePassword: 'senha', address: { state: 'PE' }, autoAcknowledge: true,
  };

  beforeEach(async () => {
    legalEntityModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(legalEntity) }) };
    eventModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    cursorModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    distribuicaoClient = { consultar: jest.fn() };
    manifestacaoClient = { manifest: jest.fn().mockResolvedValue({ status: 'registered' }) };
    eventEmitter = new EventEmitter2();

    const moduleRef = await Test.createTestingModule({
      providers: [
        NfeDistributionPoller,
        { provide: getModelToken(LegalEntityModel.name), useValue: legalEntityModel },
        { provide: getModelToken(NfeDistributionEventModel.name), useValue: eventModel },
        { provide: getModelToken(NfeDistributionCursorModel.name), useValue: cursorModel },
        { provide: NfeDistribuicaoClient, useValue: distribuicaoClient },
        { provide: NfeManifestacaoClient, useValue: manifestacaoClient },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    poller = moduleRef.get(NfeDistributionPoller);
  });

  it('cria um NfeDistributionEvent por resumo novo e avança o cursor', async () => {
    distribuicaoClient.consultar.mockResolvedValue({
      maxNsu: '15',
      ultNsu: '15',
      resumos: [{ nsu: '11', accessKey: 'CHAVE1', emitterCnpj: '11111111000111', emitterName: 'Fornecedor X' }],
      xmlByAccessKey: new Map(),
    });

    const result = await poller.pollOnce('legal1');

    expect(result.discovered).toBe(1);
    expect(eventModel.create).toHaveBeenCalledWith(expect.objectContaining({ accessKey: 'CHAVE1', manifestationStatus: 'PENDING' }));
    expect(cursorModel.updateOne).toHaveBeenCalledWith(
      { legalEntityId: 'legal1' },
      { $set: { lastNsu: '15' } },
      { upsert: true },
    );
  });

  it('não duplica evento quando o accessKey já existe', async () => {
    eventModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ accessKey: 'CHAVE1' }) });
    distribuicaoClient.consultar.mockResolvedValue({
      maxNsu: '15', ultNsu: '15',
      resumos: [{ nsu: '11', accessKey: 'CHAVE1', emitterCnpj: '11111111000111' }],
      xmlByAccessKey: new Map(),
    });

    const result = await poller.pollOnce('legal1');

    expect(result.discovered).toBe(0);
    expect(eventModel.create).not.toHaveBeenCalled();
  });

  it('dispara ciência automática (ACKNOWLEDGMENT) quando autoAcknowledge está ligado', async () => {
    distribuicaoClient.consultar.mockResolvedValue({
      maxNsu: '15', ultNsu: '15',
      resumos: [{ nsu: '11', accessKey: 'CHAVE1', emitterCnpj: '11111111000111' }],
      xmlByAccessKey: new Map(),
    });

    await poller.pollOnce('legal1');
    await new Promise((r) => setImmediate(r)); // acknowledgeAutomatically roda fire-and-forget

    expect(manifestacaoClient.manifest).toHaveBeenCalledWith(expect.objectContaining({ accessKey: 'CHAVE1', type: 'ACKNOWLEDGMENT' }));
  });

  it('emite notificação para cada nota nova descoberta', async () => {
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);
    distribuicaoClient.consultar.mockResolvedValue({
      maxNsu: '15', ultNsu: '15',
      resumos: [{ nsu: '11', accessKey: 'CHAVE1', emitterCnpj: '11111111000111', emitterName: 'Fornecedor X' }],
      xmlByAccessKey: new Map(),
    });

    await poller.pollOnce('legal1');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ type: 'fiscal.distribution.new_nfe' });
  });
});
