import { LegalEntityController } from './legal-entity.controller';

describe('LegalEntityController — extração de certificateValidUntil no upload', () => {
  let controller: LegalEntityController;
  let legalEntityService: { create: jest.Mock; update: jest.Mock };
  let signatureService: { extractCertificateData: jest.Mock };

  const file = { buffer: Buffer.from('fake-pfx-bytes') };
  const validUntil = new Date('2027-06-15T00:00:00Z');

  beforeEach(() => {
    legalEntityService = { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) };
    signatureService = { extractCertificateData: jest.fn().mockReturnValue({ cnpj: '67278239000107', companyName: 'MAX ESHOP LTDA', validUntil }) };
    controller = new LegalEntityController(legalEntityService as any, {} as any, signatureService as any);
  });

  it('create: extrai e persiste certificateValidUntil quando um certificado é enviado', async () => {
    await controller.create({ data: JSON.stringify({ companyName: 'MAX ESHOP LTDA', certPassword: 'senha123' }) }, file);

    expect(signatureService.extractCertificateData).toHaveBeenCalledWith(
      file.buffer.toString('base64'),
      'senha123',
    );
    expect(legalEntityService.create).toHaveBeenCalledWith(
      expect.objectContaining({ certificateValidUntil: validUntil }),
    );
  });

  it('update: extrai e persiste certificateValidUntil quando um novo certificado é enviado', async () => {
    await controller.update('id-1', { data: JSON.stringify({ certPassword: 'senha123' }) }, file);

    expect(legalEntityService.update).toHaveBeenCalledWith(
      'id-1',
      expect.objectContaining({ certificateValidUntil: validUntil }),
    );
  });

  it('não extrai (nem quebra) quando nenhum arquivo é enviado — mantém certificado atual', async () => {
    await controller.update('id-1', { data: JSON.stringify({ companyName: 'X' }) }, undefined);

    expect(signatureService.extractCertificateData).not.toHaveBeenCalled();
    expect(legalEntityService.update).toHaveBeenCalledWith(
      'id-1',
      expect.not.objectContaining({ certificateValidUntil: expect.anything() }),
    );
  });

  it('certificado inválido/senha errada não bloqueia o cadastro — deixa a emissão real reportar o erro', async () => {
    signatureService.extractCertificateData.mockImplementation(() => { throw new Error('bad password'); });

    await controller.create({ data: JSON.stringify({ companyName: 'X', certPassword: 'errada' }) }, file);

    expect(legalEntityService.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ certificateValidUntil: expect.anything() }),
    );
  });
});
