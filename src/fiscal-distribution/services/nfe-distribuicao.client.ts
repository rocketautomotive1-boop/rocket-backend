import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { lastValueFrom, timeout } from 'rxjs';
import { SignatureService } from '../../fiscal/services/signature.service';

export interface DistribuicaoResumo {
    nsu: string;
    accessKey: string;
    emitterCnpj: string;
    emitterName?: string;
    issueDate?: Date;
    schema: string; // resNFe, resEvento, etc — só resNFe interessa aqui
}

export interface DistribuicaoResult {
    maxNsu: string;
    ultNsu: string;
    resumos: DistribuicaoResumo[];
    xmlByAccessKey: Map<string, string>; // quando a distribuição já vem com XML completo (docZip)
}

const DISTRIBUICAO_URL = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const DISTRIBUICAO_URL_HOMOLOG = 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

/**
 * Serviço nacional (Ambiente Nacional), único endpoint independente de UF —
 * diferente de authorize/cancelNFe que são por SEFAZ. Pull-only por design:
 * não existe webhook, o consultante busca por ultNSU (cursor que nunca
 * retrocede). Rate-limit oficial: 1 consulta a cada 20min por CNPJ.
 */
@Injectable()
export class NfeDistribuicaoClient {
    private readonly logger = new Logger(NfeDistribuicaoClient.name);
    private readonly parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

    constructor(
        private readonly httpService: HttpService,
        private readonly signatureService: SignatureService,
    ) { }

    async consultar(params: {
        cnpj: string;
        uf: string;
        ultNsu: string;
        certificatePfx: string;
        certificatePassword?: string;
        environment: string;
    }): Promise<DistribuicaoResult> {
        const { cnpj, uf, ultNsu, certificatePfx, certificatePassword, environment } = params;
        const isProduction = environment === 'PRODUCTION';
        const baseUrl = isProduction ? DISTRIBUICAO_URL : DISTRIBUICAO_URL_HOMOLOG;
        const tpAmb = isProduction ? '1' : '2';
        const cUF = this.getStateIbgeCode(uf);
        const digits = cnpj.replace(/\D/g, '');

        const distDFeInt = `<distDFeInt versao="1.35" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>${tpAmb}</tpAmb><cUFAutor>${cUF}</cUFAutor><CNPJ>${digits}</CNPJ><distNSU><ultNSU>${ultNsu.padStart(15, '0')}</ultNSU></distNSU></distDFeInt>`;
        const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><soap12:Header/><soap12:Body><nfe:nfeDistDFeInteresse><nfe:nfeDadosMsg>${distDFeInt}</nfe:nfeDadosMsg></nfe:nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;

        try {
            const { cert, key } = this.signatureService.getCertAndKey(certificatePfx, certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const response$ = this.httpService.post(baseUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
                },
                httpsAgent: agent,
                timeout: 30000,
            }).pipe(timeout(35000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);

            const body = parsed?.Envelope?.Body ?? parsed?.Body;
            const retDistDFeInt = body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;

            if (!retDistDFeInt) {
                this.logger.warn(`Resposta inesperada da Distribuição DFe: ${JSON.stringify(parsed).slice(0, 500)}`);
                return { maxNsu: ultNsu, ultNsu, resumos: [], xmlByAccessKey: new Map() };
            }

            const cStat = retDistDFeInt.cStat;
            if (cStat != 137 && cStat != 138) {
                // 137 = nenhum documento localizado; 138 = documento(s) localizado(s). Outros = erro.
                this.logger.warn(`Distribuição DFe cStat=${cStat}: ${retDistDFeInt.xMotivo}`);
            }

            const maxNsu = retDistDFeInt.maxNSU || ultNsu;
            const loteDistDFeInt = retDistDFeInt.loteDistDFeInt;
            const docZipList = loteDistDFeInt
                ? (Array.isArray(loteDistDFeInt.docZip) ? loteDistDFeInt.docZip : (loteDistDFeInt.docZip ? [loteDistDFeInt.docZip] : []))
                : [];

            const resumos: DistribuicaoResumo[] = [];
            const xmlByAccessKey = new Map<string, string>();
            let ultProcessedNsu = ultNsu;

            for (const doc of docZipList) {
                const nsu = doc['@_NSU'];
                const schema = doc['@_schema'] || '';
                ultProcessedNsu = nsu;
                const decoded = this.decodeGzipBase64(doc['#text']);

                if (schema.startsWith('resNFe')) {
                    const resNFe = this.parser.parse(decoded)?.resNFe;
                    if (!resNFe) continue;
                    resumos.push({
                        nsu,
                        accessKey: resNFe.chNFe,
                        emitterCnpj: resNFe.CNPJ,
                        emitterName: resNFe.xNome,
                        issueDate: resNFe.dhEmi ? new Date(resNFe.dhEmi) : undefined,
                        schema,
                    });
                } else if (schema.startsWith('procNFe') || schema.startsWith('nfeProc')) {
                    // XML completo (autorizado) — quando a distribuição retorna via nsuEspecifico.
                    const accessKeyMatch = decoded.match(/Id="NFe(\d{44})"/);
                    if (accessKeyMatch) xmlByAccessKey.set(accessKeyMatch[1], decoded);
                }
            }

            return { maxNsu, ultNsu: ultProcessedNsu, resumos, xmlByAccessKey };
        } catch (error: any) {
            this.logger.error(`Falha ao consultar Distribuição DFe: ${error.message}`);
            throw error;
        }
    }

    private decodeGzipBase64(base64: string): string {
        const zlib = require('zlib');
        const buffer = Buffer.from(base64, 'base64');
        return zlib.gunzipSync(buffer).toString('utf-8');
    }

    private getStateIbgeCode(uf: string): string {
        const codes: { [key: string]: string } = {
            'AC': '12', 'AL': '27', 'AP': '16', 'AM': '13', 'BA': '29', 'CE': '23',
            'DF': '53', 'ES': '32', 'GO': '52', 'MA': '21', 'MT': '51', 'MS': '50',
            'MG': '31', 'PA': '15', 'PB': '25', 'PR': '41', 'PE': '26', 'PI': '22',
            'RJ': '33', 'RN': '24', 'RS': '43', 'RO': '11', 'RR': '14', 'SC': '42',
            'SP': '35', 'SE': '28', 'TO': '17'
        };
        return codes[uf.toUpperCase()] || '26';
    }
}
