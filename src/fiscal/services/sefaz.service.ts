import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { lastValueFrom, timeout } from 'rxjs';
import { SignatureService } from './signature.service';

@Injectable()
export class SefazService {
    private readonly logger = new Logger(SefazService.name);
    private readonly parser: XMLParser;

    constructor(
        private readonly httpService: HttpService,
        @Inject(forwardRef(() => SignatureService))
        private readonly signatureService: SignatureService
    ) {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: true
        });
    }

    async authorize(signedXml: string, environment: string, issuer: any): Promise<any> {
        this.logger.log(`Transmitting to SEFAZ (${environment})...`);

        if (!issuer.certificatePfx || !issuer.certificatePassword) {
            throw new Error('Certificado Digital não configurado para o emitente.');
        }

        // Base URLs for PE (Pernambuco)
        const baseUrl = environment === 'PRODUCTION'
            ? 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4'
            : 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4';

        // Generate ID Lote
        const idLote = Math.floor(Math.random() * 1000000);

        // Ensure no XML declaration in signed content
        const cleanSignedXml = signedXml.replace(/<\?xml.*?\?>/g, '').trim();

        const soapEnvelope = `
            <soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
                <soap12:Header/>
                <soap12:Body>
                    <nfe:nfeDadosMsg>
                         <enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                            <idLote>${idLote}</idLote>
                            <indSinc>1</indSinc>
                            ${cleanSignedXml}
                        </enviNFe>
                    </nfe:nfeDadosMsg>
                </soap12:Body>
            </soap12:Envelope>
        `;

        try {
            // Extract PEMs using SignatureService (node-forge handles legacy PFX better than native openssl)
            // Remove data URI scheme if present before passing to SignatureService (though SignatureService's decode64 might handle it, better safe)
            let pfxBase64 = issuer.certificatePfx;
            if (pfxBase64.includes('base64,')) {
                pfxBase64 = pfxBase64.split('base64,')[1];
            }

            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, issuer.certificatePassword);

            // Configure HTTPS Agent with PEMs
            const agent = new https.Agent({
                cert: cert,
                key: key,
                rejectUnauthorized: false
            });

            this.logger.log('Sending SOAP Request to SEFAZ...');

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote'
                },
                httpsAgent: agent,
                timeout: 30000 // Axios timeout
            }).pipe(
                timeout(35000) // RxJS timeout (slightly larger to catch axios one first if it works)
            );

            const response = await lastValueFrom(response$);
            const responseXml = response.data;
            this.logger.log(`SEFAZ Response XML length: ${responseXml.length}`);

            // Parse XML Response
            const parsed = this.parser.parse(responseXml);
            // Navigate SOAP Protocol 1.2 Return Structure
            // Envelope -> Body -> nfeResultMsg -> retEnviNFe
            const retEnviNFe = parsed?.Envelope?.Body?.nfeResultMsg?.retEnviNFe;

            if (!retEnviNFe) {
                this.logger.warn(`Estrutura SOAP inesperada: ${JSON.stringify(parsed)}`);
            }

            const cStat = retEnviNFe?.cStat;
            const xMotivo = retEnviNFe?.xMotivo;

            this.logger.log(`SEFAZ Status: ${cStat} - ${xMotivo}`);

            let status = 'error';
            let protocol = 'UNKNOWN';
            let finalMessage = xMotivo || 'Erro desconhecido';

            // Check inner protocol if available (Synchronous processing)
            if (cStat == 104) { // Lote Processado
                const protNFe = retEnviNFe.protNFe;
                // Sometimes protNFe can be an array if multiple NFes sent
                const infProt = protNFe?.infProt || protNFe?.[0]?.infProt;
                if (infProt) {
                    const cStatProt = infProt.cStat;
                    const xMotivoProt = infProt.xMotivo;
                    protocol = infProt.nProt || protocol;
                    finalMessage = `${xMotivo} | ${cStatProt} - ${xMotivoProt}`;
                    this.logger.log(`Protocol Status: ${cStatProt} - ${xMotivoProt}`);

                    if (cStatProt == 100) {
                        status = 'authorized';
                    } else if (cStatProt == 110) { // Denied
                        status = 'denied';
                    } else {
                        // Rejection (225, etc)
                        status = 'error';
                    }
                } else {
                    // Fallsback if protNFe is missing (e.g. batch error)
                    finalMessage = `${xMotivo} (Sem protocolo)`;
                }
            } else if (cStat == 103) {
                status = 'processing';
            }

            // Extract raw <protNFe>...</protNFe> from response to compose nfeProc later
            const protNFeMatch = responseXml.match(/<protNFe[\s\S]*?<\/protNFe>/);
            const protNFeXml = protNFeMatch ? protNFeMatch[0] : undefined;

            return {
                status: status,
                protocol: protocol,
                message: finalMessage,
                xml: signedXml,
                responseXml: responseXml,
                protNFeXml: protNFeXml,
                cStat: cStat
            };

        } catch (error) {
            this.logger.error(`SEFAZ Transmission Error: ${error.message}`);
            if (error.response) {
                this.logger.error(`SEFAZ Response Data: ${error.response.data}`);
            }
            throw error;
        }
    }

    async cancelNFe(nfe: any, issuer: any, justification: string): Promise<any> {
        this.logger.log(`Cancelling NFe ${nfe.accessKey} via SEFAZ evento 110111...`);

        if (!issuer.certificatePfx || !issuer.certificatePassword) {
            throw new Error('Certificado Digital não configurado para o emitente.');
        }
        if (!nfe.accessKey || !nfe.protocol) {
            throw new Error('NFe não possui chave de acesso ou protocolo de autorização.');
        }
        if (justification.length < 15) {
            throw new Error('Justificativa deve ter no mínimo 15 caracteres.');
        }

        const isProduction = nfe.environment === 'PRODUCTION';
        const baseUrl = isProduction
            ? 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4'
            : 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4';

        const tpAmb = isProduction ? '1' : '2';
        const chNFe = nfe.accessKey;
        const cUF = chNFe.substring(0, 2); // First 2 digits = cUF
        // Use current time (UTC-3 only, no extra buffer) so dhEvento is never before dhAutorizacao
        const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('.')[0] + '-03:00';
        const idEvento = `ID110111${chNFe}01`;
        const idLote = Math.floor(Math.random() * 1000000);

        const cnpj = issuer.cnpj.replace(/\D/g, '');

        // Build cancellation event XML
        const eventoXml = `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><evento versao="1.00"><infEvento Id="${idEvento}"><cOrgao>${cUF}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${nfe.protocol}</nProt><xJust>${justification.substring(0, 255)}</xJust></detEvento></infEvento></evento></envEvento>`;

        // Sign
        let pfxBase64 = issuer.certificatePfx;
        if (pfxBase64.includes('base64,')) pfxBase64 = pfxBase64.split('base64,')[1];

        const signedEvento = await this.signatureService.signEventXml(eventoXml, pfxBase64, issuer.certificatePassword);
        const cleanSigned = signedEvento.replace(/<\?xml.*?\?>/g, '').trim();

        this.logger.log(`Evento XML assinado (first 1500): ${cleanSigned.substring(0, 1500)}`);

        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><soap12:Header/><soap12:Body><nfe:nfeDadosMsg>${cleanSigned}</nfe:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, issuer.certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
                },
                httpsAgent: agent,
                timeout: 30000,
            }).pipe(timeout(35000));

            const response = await lastValueFrom(response$);
            this.logger.log(`SEFAZ Cancelamento raw XML (first 2000): ${String(response.data).substring(0, 2000)}`);

            const parsed = this.parser.parse(response.data);
            this.logger.log(`SEFAZ Cancelamento parsed: ${JSON.stringify(parsed)}`);

            // SEFAZ PE NFeRecepcaoEvento4 — path may vary, try multiple
            const body = parsed?.Envelope?.Body ?? parsed?.Body;
            const resultMsg = body?.nfeResultMsg ?? body?.['nfe:nfeResultMsg'];
            const retEnvEvento = resultMsg?.retEnvEvento;

            // Batch-level cStat (128 = lote processado; others = batch error)
            const batchCStat = retEnvEvento?.cStat;
            const batchMotivo = retEnvEvento?.xMotivo;
            this.logger.log(`SEFAZ Cancelamento batch: ${batchCStat} - ${batchMotivo}`);

            // Event-level: retEvento.infEvento
            const retEvento = retEnvEvento?.retEvento;
            const infEvento = Array.isArray(retEvento) ? retEvento[0]?.infEvento : retEvento?.infEvento;

            const cStat = infEvento?.cStat ?? batchCStat;
            const xMotivo = infEvento?.xMotivo ?? batchMotivo;
            const nProt = infEvento?.nProt;

            this.logger.log(`SEFAZ Cancelamento: ${cStat} - ${xMotivo}`);

            // 135 = Evento registrado e vinculado a NF-e cancelada
            // 136 = Evento registrado, mas NF-e não encontrada no Ambiente Nacional (also acceptable)
            const success = cStat == 135 || cStat == 136;

            return {
                status: success ? 'cancelled' : 'error',
                cStat,
                message: xMotivo || 'Resposta inesperada',
                protocol: nProt,
                responseXml: response.data,
            };
        } catch (error) {
            this.logger.error(`SEFAZ Cancelamento Error: ${error.message}`);
            if (error.response) this.logger.error(`Response: ${error.response.data}`);
            throw error;
        }
    }

    /**
     * Carta de Correção Eletrônica (CC-e, evento 110110). Mesmo padrão de
     * cancelNFe (evento 110111) — SOAP+certificado, NFeRecepcaoEvento4. CC-e
     * NÃO referencia o protocolo de autorização (diferente do cancelamento) e
     * exige nSeqEvento crescente por chave (1ª correção=1, 2ª=2, ...) — quem
     * calcula o próximo sequence é o chamador (FiscalService), com base em
     * FiscalDocument.cceEvents.length.
     */
    async correctNFe(nfe: any, issuer: any, correctionText: string, sequence: number): Promise<any> {
        this.logger.log(`Emitindo CC-e para NFe ${nfe.accessKey} (sequência ${sequence}) via evento 110110...`);

        if (!issuer.certificatePfx || !issuer.certificatePassword) {
            throw new Error('Certificado Digital não configurado para o emitente.');
        }
        if (!nfe.accessKey) {
            throw new Error('NFe não possui chave de acesso.');
        }
        if (correctionText.length < 15) {
            throw new Error('Texto de correção deve ter no mínimo 15 caracteres.');
        }

        const isProduction = nfe.environment === 'PRODUCTION';
        const baseUrl = isProduction
            ? 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4'
            : 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4';

        const tpAmb = isProduction ? '1' : '2';
        const chNFe = nfe.accessKey;
        const cUF = chNFe.substring(0, 2);
        const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('.')[0] + '-03:00';
        const seqPadded = String(sequence).padStart(2, '0');
        const idEvento = `ID110110${chNFe}${seqPadded}`;
        const idLote = Math.floor(Math.random() * 1000000);
        const cnpj = issuer.cnpj.replace(/\D/g, '');

        const eventoXml = `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><evento versao="1.00"><infEvento Id="${idEvento}"><cOrgao>${cUF}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>110110</tpEvento><nSeqEvento>${sequence}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${this.escapeXml(correctionText.substring(0, 1000))}</xCorrecao><xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso></detEvento></infEvento></evento></envEvento>`;

        let pfxBase64 = issuer.certificatePfx;
        if (pfxBase64.includes('base64,')) pfxBase64 = pfxBase64.split('base64,')[1];

        const signedEvento = await this.signatureService.signEventXml(eventoXml, pfxBase64, issuer.certificatePassword);
        const cleanSigned = signedEvento.replace(/<\?xml.*?\?>/g, '').trim();

        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><soap12:Header/><soap12:Body><nfe:nfeDadosMsg>${cleanSigned}</nfe:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, issuer.certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
                },
                httpsAgent: agent,
                timeout: 30000,
            }).pipe(timeout(35000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);

            const body = parsed?.Envelope?.Body ?? parsed?.Body;
            const resultMsg = body?.nfeResultMsg ?? body?.['nfe:nfeResultMsg'];
            const retEnvEvento = resultMsg?.retEnvEvento;

            const batchCStat = retEnvEvento?.cStat;
            const batchMotivo = retEnvEvento?.xMotivo;

            const retEvento = retEnvEvento?.retEvento;
            const infEvento = Array.isArray(retEvento) ? retEvento[0]?.infEvento : retEvento?.infEvento;

            const cStat = infEvento?.cStat ?? batchCStat;
            const xMotivo = infEvento?.xMotivo ?? batchMotivo;
            const nProt = infEvento?.nProt;

            this.logger.log(`SEFAZ CC-e: ${cStat} - ${xMotivo}`);

            // 135 = Evento registrado e vinculado a NF-e
            const success = cStat == 135;

            return {
                status: success ? 'registered' : 'error',
                cStat,
                message: xMotivo || 'Resposta inesperada',
                protocol: nProt,
                responseXml: response.data,
            };
        } catch (error) {
            this.logger.error(`SEFAZ CC-e Error: ${error.message}`);
            if (error.response) this.logger.error(`Response: ${error.response.data}`);
            throw error;
        }
    }

    /**
     * Inutilização de faixa de numeração (NFeInutilizacao4) — endpoint próprio,
     * distinto do de eventos (não é sobre uma nota específica, é sobre uma
     * faixa nunca emitida). Requer certificado, mas não chave de acesso de
     * NFe alguma — a faixa é identificada por (UF, ano, CNPJ, série, from, to).
     */
    async inutilizeRange(params: {
        issuer: any;
        uf: string;
        series: number;
        from: number;
        to: number;
        justification: string;
        environment: string;
    }): Promise<any> {
        const { issuer, uf, series, from, to, justification, environment } = params;
        this.logger.log(`Inutilizando NFe série ${series} de ${from} a ${to}...`);

        if (!issuer.certificatePfx || !issuer.certificatePassword) {
            throw new Error('Certificado Digital não configurado para o emitente.');
        }
        if (justification.length < 15) {
            throw new Error('Justificativa deve ter no mínimo 15 caracteres.');
        }
        if (from > to) {
            throw new Error('Número inicial não pode ser maior que o número final.');
        }

        const isProduction = environment === 'PRODUCTION';
        const baseUrl = isProduction
            ? 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4'
            : 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4';

        const tpAmb = isProduction ? '1' : '2';
        const cUF = this.getStateIbgeCode(uf);
        const ano = String(new Date().getFullYear()).slice(-2);
        const cnpj = issuer.cnpj.replace(/\D/g, '');
        const mod = '55';
        const serieStr = String(series).padStart(3, '0');
        const nNFIni = String(from).padStart(9, '0');
        const nNFFin = String(to).padStart(9, '0');
        const idInut = `ID${cUF}${ano}${cnpj}${mod}${serieStr}${nNFIni}${nNFFin}`;

        const inutNFeXml = `<inutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut Id="${idInut}"><tpAmb>${tpAmb}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${cUF}</cUF><ano>${ano}</ano><CNPJ>${cnpj}</CNPJ><mod>${mod}</mod><serie>${series}</serie><nNFIni>${from}</nNFIni><nNFFin>${to}</nNFFin><xJust>${this.escapeXml(justification.substring(0, 255))}</xJust></infInut></inutNFe>`;

        let pfxBase64 = issuer.certificatePfx;
        if (pfxBase64.includes('base64,')) pfxBase64 = pfxBase64.split('base64,')[1];

        const signedXml = await this.signatureService.signEventXml(inutNFeXml, pfxBase64, issuer.certificatePassword);
        const cleanSigned = signedXml.replace(/<\?xml.*?\?>/g, '').trim();

        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4"><soap12:Header/><soap12:Body><nfe:nfeDadosMsg>${cleanSigned}</nfe:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, issuer.certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF"',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF',
                },
                httpsAgent: agent,
                timeout: 30000,
            }).pipe(timeout(35000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);

            const body = parsed?.Envelope?.Body ?? parsed?.Body;
            const resultMsg = body?.nfeResultMsg ?? body?.['nfe:nfeResultMsg'];
            const retInutNFe = resultMsg?.retInutNFe;
            const infInut = retInutNFe?.infInut;

            const cStat = infInut?.cStat;
            const xMotivo = infInut?.xMotivo;
            const nProt = infInut?.nProt;

            this.logger.log(`SEFAZ Inutilização: ${cStat} - ${xMotivo}`);

            // 102 = Inutilização de número homologado
            const success = cStat == 102;

            return {
                status: success ? 'authorized' : 'rejected',
                cStat,
                message: xMotivo || 'Resposta inesperada',
                protocol: nProt,
                responseXml: response.data,
            };
        } catch (error) {
            this.logger.error(`SEFAZ Inutilização Error: ${error.message}`);
            if (error.response) this.logger.error(`Response: ${error.response.data}`);
            throw error;
        }
    }

    /**
     * EPEC (Evento Prévio de Emissão em Contingência) — quando a SEFAZ do
     * emitente está indisponível, transmite um evento simplificado ao SVC
     * (Sistema de Virtualização de Contingência) em vez da autorização normal,
     * permitindo a venda continuar (DANFE em contingência) até a NFe completa
     * ser sincronizada quando a SEFAZ volta (ver EpecSyncWorker). PE usa
     * SVC-RS (mesma infraestrutura do CCC/ConsultaCadastro).
     */
    async transmitEpec(nfe: any, issuer: any): Promise<any> {
        this.logger.log(`Transmitindo EPEC para NFe (série ${nfe.series} número ${nfe.number})...`);

        if (!issuer.certificatePfx || !issuer.certificatePassword) {
            throw new Error('Certificado Digital não configurado para o emitente.');
        }
        if (!nfe.accessKey) {
            throw new Error('NFe sem chave de acesso — gere o XML antes de transmitir o EPEC.');
        }

        const isProduction = nfe.environment === 'PRODUCTION';
        // URL anterior (www1.nfe.fazenda.gov.br/SVC-RS/...) não existe — dava 404 para
        // qualquer caminho, inclusive a raiz e o WSDL, confirmado ao vivo em produção
        // (pedido 2000018139210232: EPEC entrava corretamente em contingência mas
        // falhava com 404 antes mesmo de chegar num serviço real). O SVC-RS é hospedado
        // no domínio da SEFAZ-RS, não no portal nacional — confirmado contra a lib de
        // referência da comunidade nfephp-org/sped-nfe (storage/wsnfe_4.00_mod55.xml).
        const baseUrl = isProduction
            ? 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
            : 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx';

        const tpAmb = isProduction ? '1' : '2';
        const chNFe = nfe.accessKey;
        const cUF = chNFe.substring(0, 2);
        const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('.')[0] + '-03:00';
        const idEvento = `ID110140${chNFe}01`;
        const idLote = Math.floor(Math.random() * 1000000);
        const cnpj = issuer.cnpj.replace(/\D/g, '');

        const eventoXml = `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><evento versao="1.00"><infEvento Id="${idEvento}"><cOrgao>${cUF}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>110140</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>EPEC</descEvento><cOrgaoAutor>${cUF}</cOrgaoAutor><tpAutor>1</tpAutor><verAplic>Rocket 1.0</verAplic><dhEmi>${dhEvento}</dhEmi><tpNF>1</tpNF><IE>${issuer.ie.replace(/\D/g, '')}</IE><dest><UF>${chNFe.substring(0, 2)}</UF></dest><vNF>0.00</vNF><vICMS>0.00</vICMS><vST>0.00</vST></detEvento></infEvento></evento></envEvento>`;

        let pfxBase64 = issuer.certificatePfx;
        if (pfxBase64.includes('base64,')) pfxBase64 = pfxBase64.split('base64,')[1];

        const signedEvento = await this.signatureService.signEventXml(eventoXml, pfxBase64, issuer.certificatePassword);
        const cleanSigned = signedEvento.replace(/<\?xml.*?\?>/g, '').trim();
        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><soap12:Header/><soap12:Body><nfe:nfeDadosMsg>${cleanSigned}</nfe:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, issuer.certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
                },
                httpsAgent: agent,
                timeout: 30000,
            }).pipe(timeout(35000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);

            const body = parsed?.Envelope?.Body ?? parsed?.Body;
            const retEnvEvento = body?.nfeResultMsg?.retEnvEvento;
            const batchCStat = retEnvEvento?.cStat;
            const retEvento = retEnvEvento?.retEvento;
            const infEvento = Array.isArray(retEvento) ? retEvento[0]?.infEvento : retEvento?.infEvento;
            const cStat = infEvento?.cStat ?? batchCStat;
            const xMotivo = infEvento?.xMotivo ?? retEnvEvento?.xMotivo;
            const nProt = infEvento?.nProt;

            // 135 = evento registrado
            const success = cStat == 135;
            this.logger.log(`SVC EPEC: ${cStat} - ${xMotivo}`);

            return {
                status: success ? 'authorized_contingency' : 'error',
                cStat,
                message: xMotivo || 'Resposta inesperada',
                protocol: nProt,
            };
        } catch (error: any) {
            this.logger.error(`SVC EPEC Error: ${error.message}`);
            throw error;
        }
    }

    private escapeXml(text: string): string {
        return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
    }

    private getStateIbgeCode(uf: string): string {
        const codes: { [key: string]: string } = {
            'AC': '12', 'AL': '27', 'AP': '16', 'AM': '13', 'BA': '29', 'CE': '23',
            'DF': '53', 'ES': '32', 'GO': '52', 'MA': '21', 'MT': '51', 'MS': '50',
            'MG': '31', 'PA': '15', 'PB': '25', 'PR': '41', 'PE': '26', 'PI': '22',
            'RJ': '33', 'RN': '24', 'RS': '43', 'RO': '11', 'RR': '14', 'SC': '42',
            'SP': '35', 'SE': '28', 'TO': '17'
        };
        return codes[uf.toUpperCase()] || '26'; // Default PE (única UF hoje transmitida)
    }
}
