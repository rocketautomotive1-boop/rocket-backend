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

            return {
                status: status,
                protocol: protocol,
                message: finalMessage,
                xml: signedXml,
                responseXml: responseXml,
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
}
