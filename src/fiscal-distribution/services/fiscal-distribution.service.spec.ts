import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FiscalDistributionService } from './fiscal-distribution.service';
import { NfeDistributionEventModel } from '../schemas/nfe-distribution-event.schema';
import { LegalEntityModel } from '../../legal-entity/schemas/legal-entity.schema';
import { NfeManifestacaoClient } from './nfe-manifestacao.client';
import { NfeDistribuicaoClient } from './nfe-distribuicao.client';
import { NfeImportService } from '../../fiscal/services/nfe-import.service';

describe('FiscalDistributionService', () => {
  let service: FiscalDistributionService;
  let eventModel: any;
  let legalEntityModel: any;
  let manifestacaoClient: { manifest: jest.Mock };
  let distribuicaoClient: { consultar: jest.Mock };
  let nfeImportService: { processXml: jest.Mock };

  const legalEntity = { _id: 'legal1', cnpj: '00000000000191', certificatePfx: 'pfx', certificatePassword: 'senha', address: { state: 'PE' } };

  beforeEach(async () => {
    eventModel = {
      findById: jest.fn(),
      find: jest.fn(),
    };
    legalEntityModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(legalEntity) }) };
    manifestacaoClient = { manifest: jest.fn() };
    distribuicaoClient = { consultar: jest.fn() };
    nfeImportService = { processXml: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalDistributionService,
        { provide: getModelToken(NfeDistributionEventModel.name), useValue: eventModel },
        { provide: getModelToken(LegalEntityModel.name), useValue: legalEntityModel },
        { provide: NfeManifestacaoClient, useValue: manifestacaoClient },
        { provide: NfeDistribuicaoClient, useValue: distribuicaoClient },
        { provide: NfeImportService, useValue: nfeImportService },
      ],
    }).compile();

    service = moduleRef.get(FiscalDistributionService);
  });

  describe('manifest', () => {
    it('marca o evento como CONFIRMED após manifestação bem-sucedida', async () => {
      const event = { _id: 'ev1', accessKey: 'CHAVE1', legalEntityId: 'legal1', manifestationStatus: 'PENDING', save: jest.fn().mockResolvedValue(undefined) };
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(event) });
      manifestacaoClient.manifest.mockResolvedValue({ status: 'registered', protocol: 'prot-1', message: 'OK' });

      const result = await service.manifest('ev1', 'CONFIRMATION');

      expect(result.status).toBe('CONFIRMED');
      expect(event.manifestationStatus).toBe('CONFIRMED');
      expect(event.save).toHaveBeenCalled();
    });

    it('lança NotFoundException quando o evento não existe', async () => {
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.manifest('ev-inexistente', 'ACKNOWLEDGMENT')).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException quando a SEFAZ rejeita a manifestação', async () => {
      const event = { _id: 'ev1', accessKey: 'CHAVE1', legalEntityId: 'legal1', manifestationStatus: 'PENDING', save: jest.fn() };
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(event) });
      manifestacaoClient.manifest.mockResolvedValue({ status: 'error', cStat: '999', message: 'Rejeitado' });

      await expect(service.manifest('ev1', 'CONFIRMATION')).rejects.toThrow(BadRequestException);
      expect(event.save).not.toHaveBeenCalled();
    });
  });

  describe('importXml', () => {
    it('exige manifestação (ACKNOWLEDGED/CONFIRMED) antes de importar', async () => {
      const event = { _id: 'ev1', accessKey: 'CHAVE1', legalEntityId: 'legal1', manifestationStatus: 'PENDING' };
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(event) });

      await expect(service.importXml('ev1')).rejects.toThrow(/Manifeste a NFe/);
    });

    it('importa direto quando o XML já está salvo no evento', async () => {
      const event = { _id: 'ev1', accessKey: 'CHAVE1', legalEntityId: 'legal1', manifestationStatus: 'CONFIRMED', xml: '<nfeProc/>', save: jest.fn().mockResolvedValue(undefined) };
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(event) });
      nfeImportService.processXml.mockResolvedValue({ _id: 'entry1' });

      const result = await service.importXml('ev1');

      expect(nfeImportService.processXml).toHaveBeenCalledWith('<nfeProc/>');
      expect(distribuicaoClient.consultar).not.toHaveBeenCalled();
      expect(result).toEqual({ _id: 'entry1' });
    });

    it('lança erro claro quando o XML completo ainda não está disponível na distribuição', async () => {
      const event = { _id: 'ev1', accessKey: 'CHAVE1', legalEntityId: 'legal1', manifestationStatus: 'ACKNOWLEDGED', xml: undefined, nsu: '10' };
      eventModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(event) });
      distribuicaoClient.consultar.mockResolvedValue({ xmlByAccessKey: new Map() });

      await expect(service.importXml('ev1')).rejects.toThrow(/XML completo ainda não disponível/);
    });
  });
});
