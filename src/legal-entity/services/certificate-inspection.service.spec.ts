import { BadRequestException } from '@nestjs/common';
import { CertificateInspectionService } from './certificate-inspection.service';

describe('CertificateInspectionService', () => {
  let service: CertificateInspectionService;
  let signatureService: { extractCertificateData: jest.Mock };
  let cccLookup: { lookup: jest.Mock };
  let cadConsultaCadastro: { consult: jest.Mock };

  const extracted = {
    cnpj: '00000000000191',
    companyName: 'ROCKET AUTO PECAS LTDA',
    validUntil: new Date('2027-01-01'),
  };

  beforeEach(() => {
    signatureService = { extractCertificateData: jest.fn().mockReturnValue(extracted) };
    cccLookup = { lookup: jest.fn().mockResolvedValue({ ie: '123456', situacao: 'ATIVO', taxRegime: 'SIMPLES_NACIONAL' }) };
    cadConsultaCadastro = { consult: jest.fn().mockResolvedValue({ icmsEnabled: true, situacao: 'ATIVO' }) };

    service = new CertificateInspectionService(signatureService as any, cccLookup as any, cadConsultaCadastro as any);
  });

  it('combina certificado + CCC + ConsultaCadastro num resultado único', async () => {
    const result = await service.inspect('pfx-base64', 'senha', 'PE');

    expect(result).toMatchObject({
      cnpj: '00000000000191',
      companyName: 'ROCKET AUTO PECAS LTDA',
      certificateValidUntil: extracted.validUntil,
      ie: '123456',
      taxRegime: 'SIMPLES_NACIONAL',
      icmsEnabled: true,
    });
  });

  it('lança BadRequestException quando o certificado não pode ser lido', async () => {
    signatureService.extractCertificateData.mockImplementation(() => { throw new Error('senha incorreta'); });

    await expect(service.inspect('pfx-base64', 'errada', 'PE')).rejects.toThrow(BadRequestException);
  });

  it('lança BadRequestException quando o CNPJ extraído é inválido', async () => {
    signatureService.extractCertificateData.mockReturnValue({ ...extracted, cnpj: '' });

    await expect(service.inspect('pfx-base64', 'senha', 'PE')).rejects.toThrow(/não contém um CNPJ válido/);
  });

  it('não falha quando CCC ou ConsultaCadastro dão erro — segue com dados parciais', async () => {
    cccLookup.lookup.mockRejectedValue(new Error('timeout'));
    cadConsultaCadastro.consult.mockRejectedValue(new Error('timeout'));

    const result = await service.inspect('pfx-base64', 'senha', 'PE');

    expect(result.cnpj).toBe('00000000000191');
    expect(result.ie).toBeUndefined();
    expect(result.taxRegime).toBeNull();
  });
});
