import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EpecSyncWorker } from './epec-sync.worker';
import { FiscalDocumentModel } from '../schemas/fiscal.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { SefazService } from './sefaz.service';

describe('EpecSyncWorker', () => {
  let worker: EpecSyncWorker;
  let fiscalDocumentModel: { find: jest.Mock };
  let legalEntityService: { findAllInContingency: jest.Mock; updateContingencyState: jest.Mock };
  let sefazService: { authorize: jest.Mock };

  const entity = { _id: 'legal1', cnpj: '00000000000191', companyName: 'Rocket', contingencySuccessCount: 0 };

  beforeEach(async () => {
    fiscalDocumentModel = { find: jest.fn() };
    legalEntityService = {
      findAllInContingency: jest.fn().mockResolvedValue([entity]),
      updateContingencyState: jest.fn().mockResolvedValue(undefined),
    };
    sefazService = { authorize: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpecSyncWorker,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: LegalEntityService, useValue: legalEntityService },
        { provide: SefazService, useValue: sefazService },
      ],
    }).compile();

    worker = moduleRef.get(EpecSyncWorker);
  });

  it('sincroniza NFes AUTHORIZED_CONTINGENCY cujo issuer bate com a LegalEntity', async () => {
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '00000000000191' }, save: jest.fn().mockResolvedValue(undefined),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });
    sefazService.authorize.mockResolvedValue({ status: 'authorized', protocol: 'prot-1' });

    await worker.syncPendingContingencyNFes();

    expect(nfe.status).toBe('AUTHORIZED');
    expect(nfe.save).toHaveBeenCalled();
  });

  it('ignora NFes cujo issuer não bate com a LegalEntity em contingência', async () => {
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '99999999999999' }, save: jest.fn(),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });

    await worker.syncPendingContingencyNFes();

    expect(sefazService.authorize).not.toHaveBeenCalled();
    expect(nfe.save).not.toHaveBeenCalled();
  });

  it('desativa contingencyMode após atingir o streak de sucessos consecutivos', async () => {
    entity.contingencySuccessCount = 2; // já tem 2, mais 1 sucesso = 3 = streak completo
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '00000000000191' }, save: jest.fn().mockResolvedValue(undefined),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });
    sefazService.authorize.mockResolvedValue({ status: 'authorized', protocol: 'prot-1' });

    await worker.syncPendingContingencyNFes();

    expect(legalEntityService.updateContingencyState).toHaveBeenCalledWith('legal1', expect.objectContaining({ contingencyMode: false }));
  });

  it('interrompe a sincronização da rodada ao encontrar uma falha (SEFAZ provavelmente ainda fora)', async () => {
    const nfe1 = { accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY', issuer: { cnpj: '00000000000191' }, save: jest.fn() };
    const nfe2 = { accessKey: 'CHAVE2', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY', issuer: { cnpj: '00000000000191' }, save: jest.fn() };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe1, nfe2]) }) });
    sefazService.authorize.mockRejectedValue(new Error('ETIMEDOUT'));

    await worker.syncPendingContingencyNFes();

    expect(sefazService.authorize).toHaveBeenCalledTimes(1); // não tenta o segundo após falha no primeiro
    expect(legalEntityService.updateContingencyState).not.toHaveBeenCalled();
  });
});
