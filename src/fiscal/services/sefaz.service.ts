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
}
