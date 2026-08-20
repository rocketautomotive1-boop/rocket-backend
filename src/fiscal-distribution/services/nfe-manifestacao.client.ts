import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { lastValueFrom, timeout } from 'rxjs';
import { SignatureService } from '../../fiscal/services/signature.service';

export type ManifestationType = 'CONFIRMATION' | 'ACKNOWLEDGMENT' | 'UNKNOWN' | 'NOT_REALIZED';

const TP_EVENTO_BY_TYPE: Record<ManifestationType, string> = {
    CONFIRMATION: '210200',
    ACKNOWLEDGMENT: '210210',
    UNKNOWN: '210220',
    NOT_REALIZED: '210240',
};

const DESC_BY_TYPE: Record<ManifestationType, string> = {
    CONFIRMATION: 'Confirmacao da Operacao',
    ACKNOWLEDGMENT: 'Ciencia da Operacao',
    UNKNOWN: 'Desconhecimento da Operacao',
    NOT_REALIZED: 'Operacao nao Realizada',
};

const MANIFESTACAO_URL = 'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
const MANIFESTACAO_URL_HOMOLOG = 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';

/**
 * Manifesto do Destinatário — mesmo padrão de evento assinado que
 * SefazService.cancelNFe/correctNFe, mas transmitido ao Ambiente Nacional
 * (não à SEFAZ do emitente autorizador). Ver Seção 5 da spec.
 */
@Injectable()
export class NfeManifestacaoClient {
    private readonly logger = new Logger(NfeManifestacaoClient.name);
    private readonly parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

    constructor(
        private readonly httpService: HttpService,
        private readonly signatureService: SignatureService,
    ) { }

    async manifest(params: {
        accessKey: string;
        cnpj: string;
        type: ManifestationType;
        justification?: string;
        certificatePfx: string;
        certificatePassword?: string;
        environment: string;
    }): Promise<{ status: 'registered' | 'error'; cStat?: string; message: string; protocol?: string }> {
        const { accessKey, cnpj, type, justification, certificatePfx, certificatePassword, environment } = params;

        if (type === 'UNKNOWN' && (!justification || justification.length < 15)) {
            throw new Error('Justificativa deve ter no mínimo 15 caracteres para Desconhecimento da Operação.');
        }

        const isProduction = environment === 'PRODUCTION';
        const baseUrl = isProduction ? MANIFESTACAO_URL : MANIFESTACAO_URL_HOMOLOG;
        const tpAmb = isProduction ? '1' : '2';
        const tpEvento = TP_EVENTO_BY_TYPE[type];
        const cUF = accessKey.substring(0, 2);
        const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('.')[0] + '-03:00';
        const idEvento = `ID${tpEvento}${accessKey}01`;
        const idLote = Math.floor(Math.random() * 1000000);
        const digits = cnpj.replace(/\D/g, '');

        const xJust = justification ? `<xJust>${this.escapeXml(justification.substring(0, 255))}</xJust>` : '';
        const eventoXml = `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>${idLote}</idLote><evento versao="1.00"><infEvento Id="${idEvento}"><cOrgao>${cUF}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${digits}</CNPJ><chNFe>${accessKey}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${DESC_BY_TYPE[type]}</descEvento>${xJust}</detEvento></infEvento></evento></envEvento>`;

        let pfxBase64 = certificatePfx;
        if (pfxBase64.includes('base64,')) pfxBase64 = pfxBase64.split('base64,')[1];

        const signedEvento = await this.signatureService.signEventXml(eventoXml, pfxBase64, certificatePassword);
        const cleanSigned = signedEvento.replace(/<\?xml.*?\?>/g, '').trim();
        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><soap12:Header/><soap12:Body><nfe:nfeDadosMsg>${cleanSigned}</nfe:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(pfxBase64, certificatePassword);
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

            // 135 = evento registrado e vinculado a NF-e
            const success = cStat == 135;
            return {
                status: success ? 'registered' : 'error',
                cStat,
                message: xMotivo || 'Resposta inesperada',
                protocol: nProt,
            };
        } catch (error: any) {
            this.logger.error(`Falha ao manifestar NFe ${accessKey}: ${error.message}`);
            throw error;
        }
    }

    private escapeXml(text: string): string {
        return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
    }
}
