import { of } from 'rxjs';
import { SefazService } from './sefaz.service';

/**
 * Cobertura focada em transmitEpec — bugs reais corrigidos em produção:
 * 1. cOrgao=91 (Ambiente Nacional), não a UF do emitente — causava "582 - UF não
 *    atendida pela SVC-[AN/RS]".
 * 2. <dest> sem CNPJ/CPF do destinatário e vNF/vICMS/vST fora de <dest> (schema oficial,
 *    nfephp-org/sped-nfe schemes/PL_009_V4/leiauteEPEC_v1.00.xsd, exige documento
 *    obrigatório e os valores DENTRO de <dest>).
 * 3. Causa raiz real: o EPEC não vai para o SVC-RS. Duas tentativas anteriores miraram
 *    SVC-RS (v4 "recepcaoevento4.asmx" → 215 nível lote; v1.00 "recepcaoevento.asmx"
 *    com nfeCabecMsg → 404). Confirmado contra a lib de referência nfephp-org/sped-nfe
 *    (src/Tools.php::sefazEPEC chama sefazEvento('AN', ...)): o alvo real é o provedor
 *    AN (Ambiente Nacional, www.nfe.fazenda.gov.br), usando o MESMO serviço
 *    NFeRecepcaoEvento4 (v4) já usado no cancelamento — sem soap:Header extra.
 */
describe('SefazService.transmitEpec — montagem do evento EPEC', () => {
  let service: SefazService;
  let httpService: { post: jest.Mock };
  let signatureService: {
    signEventXml: jest.Mock;
    getCertAndKey: jest.Mock;
  };

  const issuer = {
    certificatePfx: 'ZmFrZS1wZngtYmFzZTY0', // "fake-pfx-base64"
    certificatePassword: 'senha123',
    cnpj: '67278239000107',
    ie: '134858140',
  };

  const nfe = { series: 7, number: 13, environment: 'PRODUCTION', accessKey: '26260867278239000107550070000000134942967088' };

  const nfeXmlWithCnpjDest = `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><dest><CNPJ>11222333000181</CNPJ><IE>0580097323</IE><enderDest><UF>RS</UF></enderDest></dest><total><ICMSTot><vNF>150.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const nfeXmlWithCpfDest = `<NFe><infNFe><dest><CPF>06726952430</CPF><enderDest><UF>PE</UF></enderDest></dest><total><ICMSTot><vNF>50.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></ICMSTot></total></infNFe></NFe>`;
  const nfeXmlDestSemDocumento = `<NFe><infNFe><dest><enderDest><UF>PE</UF></enderDest></dest><total><ICMSTot><vNF>50.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></ICMSTot></total></infNFe></NFe>`;

  const okSoapResponse = {
    data: `<soap:Envelope><soap:Body><nfeResultMsg><retEnvEvento><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><nProt>PROT1</nProt></infEvento></retEvento></retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`,
  };

  beforeEach(() => {
    httpService = { post: jest.fn().mockReturnValue(of(okSoapResponse)) };
    signatureService = {
      signEventXml: jest.fn().mockImplementation(async (xml: string) => xml),
      getCertAndKey: jest.fn().mockReturnValue({ cert: 'CERT', key: 'KEY' }),
    };
    service = new SefazService(httpService as any, signatureService as any);
  });

  it('monta <dest> com CNPJ, UF e vNF/vICMS/vST DENTRO de <dest>, na ordem exigida pelo schema', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const eventoXml: string = signatureService.signEventXml.mock.calls[0][0];
    expect(eventoXml).toContain('<dest><UF>RS</UF><CNPJ>11222333000181</CNPJ><IE>0580097323</IE><vNF>150.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></dest>');
  });

  it('monta <dest> com CPF quando o destinatário é pessoa física (sem IE)', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCpfDest);

    const eventoXml: string = signatureService.signEventXml.mock.calls[0][0];
    expect(eventoXml).toContain('<dest><UF>PE</UF><CPF>06726952430</CPF><vNF>50.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></dest>');
  });

  it('cOrgao do infEvento é sempre 91 (Ambiente Nacional), nunca a UF do emitente', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const eventoXml: string = signatureService.signEventXml.mock.calls[0][0];
    expect(eventoXml).toContain('<cOrgao>91</cOrgao>');
    // cOrgaoAutor continua sendo a UF real do emitente (26 = PE, extraído da chave)
    expect(eventoXml).toContain('<cOrgaoAutor>26</cOrgaoAutor>');
  });

  it('lança erro claro quando o <dest> da NFe não tem CNPJ nem CPF do destinatário', async () => {
    await expect(service.transmitEpec(nfe, issuer, nfeXmlDestSemDocumento)).rejects.toThrow(/CNPJ\/CPF/);
  });

  it('lança erro claro quando o XML da NFe está sem dest/total (malformado)', async () => {
    await expect(service.transmitEpec(nfe, issuer, '<NFe><infNFe></infNFe></NFe>')).rejects.toThrow(/dest\/total/);
  });

  it('usa soap:Header vazio (padrão v4, mesmo do cancelamento) — sem nfeCabecMsg, que é do webservice legado v1.00 (não usado aqui)', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const soapEnvelope: string = httpService.post.mock.calls[0][1];
    expect(soapEnvelope).toContain('<soap12:Header/>');
    expect(soapEnvelope).not.toContain('nfeCabecMsg');
  });

  it('usa o webservice NFeRecepcaoEvento4 do provedor AN (Ambiente Nacional) — o EPEC não vai para o SVC-RS, vai para www.nfe.fazenda.gov.br', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const url: string = httpService.post.mock.calls[0][0];
    expect(url).toBe('https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
  });
});
