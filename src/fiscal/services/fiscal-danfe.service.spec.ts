import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalDanfeService } from './fiscal-danfe.service';
import { FiscalDocumentModel } from '../schemas/fiscal.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { S3Service } from '../../common/s3/s3.service';
import { DanfeQrCodeService } from './danfe-qrcode.service';
import { FISCAL_EVENTS, FiscalNfeAuthorizedEvent } from '../events/fiscal.events';

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('bwip-js', () => ({
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-barcode-png')),
}));

const SAMPLE_XML = `<?xml version="1.0"?><nfeProc><NFe><infNFe>
  <ide><tpAmb>2</tpAmb></ide>
  <emit><CNPJ>00000000000191</CNPJ><xNome>Rocket Automotive</xNome><IE>123456</IE>
    <enderEmit><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><xMun>Recife</xMun><UF>PE</UF><CEP>50000000</CEP></enderEmit>
  </emit>
  <dest><CPF>06726952430</CPF><xNome>Cliente Teste</xNome>
    <enderDest><xLgr>Rua B</xLgr><nro>2</nro><xBairro>Bairro</xBairro><xMun>Jaboatao</xMun><UF>PE</UF></enderDest>
  </dest>
  <det><prod><cProd>SKU1</cProd><xProd>Amortecedor</xProd><NCM>87089990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>150.00</vUnCom><vProd>150.00</vProd></prod></det>
  <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vFrete>0.00</vFrete><vDesc>0.00</vDesc><vNF>150.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

describe('FiscalDanfeService', () => {
  let service: FiscalDanfeService;
  let fiscalDocumentModel: { updateOne: jest.Mock };
  let legalEntityService: { findActive: jest.Mock };
  let s3: { uploadFile: jest.Mock };
  let qrCodeService: { buildQrCodeDataUri: jest.Mock };
  let eventEmitter: EventEmitter2;

  const event = new FiscalNfeAuthorizedEvent(
    'nfe-1', 'order-1', 'store-1', 'CHAVE123', 1, 42, SAMPLE_XML, 'cliente@example.com', 'Cliente Teste',
  );

  beforeEach(async () => {
    fiscalDocumentModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }) };
    legalEntityService = { findActive: jest.fn().mockResolvedValue({ csc: 'csc-secret', cscId: '000001' }) };
    s3 = { uploadFile: jest.fn().mockResolvedValue('https://s3.example.com/fiscal/danfe/CHAVE123.pdf') };
    qrCodeService = { buildQrCodeDataUri: jest.fn().mockResolvedValue('data:image/png;base64,fakeqr') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalDanfeService,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: LegalEntityService, useValue: legalEntityService },
        { provide: S3Service, useValue: s3 },
        { provide: DanfeQrCodeService, useValue: qrCodeService },
        EventEmitter2,
      ],
    }).compile();

    service = moduleRef.get(FiscalDanfeService);
    eventEmitter = moduleRef.get(EventEmitter2);
  });

  it('gera o PDF (com QR code e código de barras), salva danfeUrl e emite DANFE_READY', async () => {
    const listener = jest.fn();
    eventEmitter.on(FISCAL_EVENTS.DANFE_READY, listener);

    await service.onAuthorized(event);

    expect(qrCodeService.buildQrCodeDataUri).toHaveBeenCalledWith({
      accessKey: 'CHAVE123',
      uf: 'PE',
      environment: 'HOMOLOGATION',
      csc: 'csc-secret',
      cscId: '000001',
    });
    expect(s3.uploadFile).toHaveBeenCalledWith(expect.any(Buffer), 'fiscal/danfe/CHAVE123.pdf', 'application/pdf', true);
    expect(fiscalDocumentModel.updateOne).toHaveBeenCalledWith(
      { _id: 'nfe-1' },
      { $set: { danfeUrl: 'https://s3.example.com/fiscal/danfe/CHAVE123.pdf' } },
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      nfeId: 'nfe-1',
      danfeUrl: 'https://s3.example.com/fiscal/danfe/CHAVE123.pdf',
      customerEmail: 'cliente@example.com',
    });
  });

  it('gera o PDF sem QR code quando a LegalEntity não tem CSC configurado', async () => {
    qrCodeService.buildQrCodeDataUri.mockResolvedValue(null);

    await expect(service.onAuthorized(event)).resolves.toBeUndefined();
    expect(s3.uploadFile).toHaveBeenCalled();
  });

  it('emite DANFE_FAILED quando o upload falha, sem propagar exceção', async () => {
    s3.uploadFile.mockRejectedValue(new Error('S3 unreachable'));
    const listener = jest.fn();
    eventEmitter.on(FISCAL_EVENTS.DANFE_FAILED, listener);

    await expect(service.onAuthorized(event)).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ nfeId: 'nfe-1' });
  });

  it('produção real (tpAmb=1) não mostra o aviso de homologação nem usa a URL de QR code de homologação', async () => {
    // fast-xml-parser converte <tpAmb>1</tpAmb> pro NÚMERO 1, não a string '1' —
    // === '1' / !== '1' comparando direto sempre davam o resultado errado.
    const prodXml = SAMPLE_XML.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>');
    const prodEvent = new FiscalNfeAuthorizedEvent(
      'nfe-2', 'order-2', 'store-2', 'CHAVE456', 1, 43, prodXml, 'cliente@example.com', 'Cliente Teste',
    );

    let capturedHtml = '';
    const puppeteer = require('puppeteer');
    puppeteer.launch.mockResolvedValueOnce({
      newPage: jest.fn().mockResolvedValue({
        setContent: jest.fn().mockImplementation((html) => { capturedHtml = html; return Promise.resolve(); }),
        pdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    });

    await service.onAuthorized(prodEvent);

    expect(qrCodeService.buildQrCodeDataUri).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'PRODUCTION' }),
    );
    expect(capturedHtml).not.toContain('SEM VALOR FISCAL');
  });
});
