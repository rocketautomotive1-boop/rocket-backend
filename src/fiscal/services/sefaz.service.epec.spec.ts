import { of } from 'rxjs';
import { SefazService } from './sefaz.service';

/**
 * Cobertura focada em transmitEpec — três bugs reais corrigidos em produção, todos
 * culminando no mesmo sintoma "215 - Rejeição: Falha no schema XML":
 * 1. cOrgao=91 (Ambiente Nacional), não a UF do emitente — causava "582 - UF não
 *    atendida pela SVC-[AN/RS]".
 * 2. <dest> sem CNPJ/CPF do destinatário e vNF/vICMS/vST fora de <dest> (schema oficial,
 *    nfephp-org/sped-nfe schemes/PL_009_V4/leiauteEPEC_v1.00.xsd, exige documento
 *    obrigatório e os valores DENTRO de <dest>).
 * 3. Causa raiz real do "215" persistente mesmo com o XML do evento validando
 *    corretamente contra o schema completo: o SVC-RS de contingência usa o webservice
 *    LEGADO RecepcaoEvento (v1.00, namespace .../wsdl/RecepcaoEvento — sem "NFe", sem
 *    "4"), que exige um <soap:Header><nfeCabecMsg>{cUF, versaoDados}</nfeCabecMsg>
 *    ausente antes — a SEFAZ rejeitava o LOTE inteiro antes de validar o evento em si
 *    (confirmado ao vivo comparando `nível: lote` vs `nível: evento` na resposta).
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

  it('inclui soap:Header com nfeCabecMsg{cUF, versaoDados} — sem isso a SEFAZ rejeitava o LOTE inteiro (215)', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const soapEnvelope: string = httpService.post.mock.calls[0][1];
    expect(soapEnvelope).toContain('<soap12:Header><nfe:nfeCabecMsg><cUF>26</cUF><versaoDados>1.00</versaoDados></nfe:nfeCabecMsg></soap12:Header>');
  });

  it('usa o webservice legado RecepcaoEvento (v1.00, sem sufixo "4") — recepcaoevento4.asmx é um serviço diferente que rejeita o formato v1.00', async () => {
    await service.transmitEpec(nfe, issuer, nfeXmlWithCnpjDest);

    const url: string = httpService.post.mock.calls[0][0];
    expect(url).toBe('https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento.asmx');
  });
});
