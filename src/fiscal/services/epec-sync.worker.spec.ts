import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EpecSyncWorker } from './epec-sync.worker';
import { FiscalDocumentModel } from '../schemas/fiscal.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { SefazService } from './sefaz.service';
import { FiscalService } from './fiscal.service';

describe('EpecSyncWorker', () => {
  let worker: EpecSyncWorker;
  let fiscalDocumentModel: { find: jest.Mock };
  let legalEntityService: { findAllInContingency: jest.Mock; updateContingencyState: jest.Mock };
  let sefazService: { authorize: jest.Mock; checkStatus: jest.Mock };
  let fiscalService: { emitAuthorizedEvent: jest.Mock };

  const entity = { _id: 'legal1', cnpj: '00000000000191', companyName: 'Rocket', contingencySuccessCount: 0 };

  beforeEach(async () => {
    entity.contingencySuccessCount = 0;
    fiscalDocumentModel = { find: jest.fn() };
    legalEntityService = {
      findAllInContingency: jest.fn().mockResolvedValue([entity]),
      updateContingencyState: jest.fn().mockResolvedValue(undefined),
    };
    sefazService = { authorize: jest.fn(), checkStatus: jest.fn() };
    fiscalService = { emitAuthorizedEvent: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpecSyncWorker,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: LegalEntityService, useValue: legalEntityService },
        { provide: SefazService, useValue: sefazService },
        { provide: FiscalService, useValue: fiscalService },
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

  it('emite NFE_AUTHORIZED ao confirmar uma NFe pós-contingência — sem isso o anexo automático ao Mercado Livre, o DANFE e a notificação nunca disparavam para notas emitidas via EPEC', async () => {
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '00000000000191' }, save: jest.fn().mockResolvedValue(undefined),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });
    sefazService.authorize.mockResolvedValue({ status: 'authorized', protocol: 'prot-1' });

    await worker.syncPendingContingencyNFes();

    expect(fiscalService.emitAuthorizedEvent).toHaveBeenCalledWith(nfe);
  });

  it('não emite NFE_AUTHORIZED quando a sincronização ainda falha (SEFAZ ainda indisponível)', async () => {
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '00000000000191' }, save: jest.fn(),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });
    sefazService.authorize.mockRejectedValue(new Error('ETIMEDOUT'));

    await worker.syncPendingContingencyNFes();

    expect(fiscalService.emitAuthorizedEvent).not.toHaveBeenCalled();
  });

  it('ignora NFes cujo issuer não bate com a LegalEntity em contingência', async () => {
    const nfe = {
      accessKey: 'CHAVE1', xml: '<xml/>', environment: 'PRODUCTION', status: 'AUTHORIZED_CONTINGENCY',
      issuer: { cnpj: '99999999999999' }, save: jest.fn(),
    };
    fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([nfe]) }) });
    sefazService.checkStatus.mockResolvedValue({ online: false }); // nenhuma nota relevante → cai no probe direto

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

  describe('sem NFes AUTHORIZED_CONTINGENCY — probe direto de status da SEFAZ', () => {
    beforeEach(() => {
      fiscalDocumentModel.find.mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) });
    });

    it('sonda o status da SEFAZ quando não há nenhuma NFe presa em contingência — sem isso, contingencyMode ficava travado para sempre se o EPEC nunca tivesse funcionado', async () => {
      sefazService.checkStatus.mockResolvedValue({ online: true, cStat: '107' });

      await worker.syncPendingContingencyNFes();

      expect(sefazService.checkStatus).toHaveBeenCalledWith(entity, 'PRODUCTION');
    });

    it('sai de contingência após 3 probes de status online consecutivos (mesmo streak do fluxo normal)', async () => {
      entity.contingencySuccessCount = 2;
      sefazService.checkStatus.mockResolvedValue({ online: true, cStat: '107' });

      await worker.syncPendingContingencyNFes();

      expect(legalEntityService.updateContingencyState).toHaveBeenCalledWith('legal1', expect.objectContaining({ contingencyMode: false }));
    });

    it('não sai de contingência com um único probe online (evita flapping)', async () => {
      sefazService.checkStatus.mockResolvedValue({ online: true, cStat: '107' });

      await worker.syncPendingContingencyNFes();

      expect(legalEntityService.updateContingencyState).toHaveBeenCalledWith('legal1', { contingencySuccessCount: 1 });
    });

    it('zera o streak quando o probe reporta SEFAZ offline', async () => {
      entity.contingencySuccessCount = 2;
      sefazService.checkStatus.mockResolvedValue({ online: false });

      await worker.syncPendingContingencyNFes();

      expect(legalEntityService.updateContingencyState).toHaveBeenCalledWith('legal1', { contingencySuccessCount: 0 });
      expect(legalEntityService.updateContingencyState).not.toHaveBeenCalledWith('legal1', expect.objectContaining({ contingencyMode: false }));
    });
  });
});
