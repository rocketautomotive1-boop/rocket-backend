import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { lastValueFrom, timeout } from 'rxjs';
import { SignatureService } from '../../fiscal/services/signature.service';

export interface CccLookupResult {
    ie?: string;
    situacao?: string;
    taxRegime: 'SIMPLES_NACIONAL' | 'NORMAL' | null;
}

/**
 * Cadastro Centralizado de Contribuintes (CCC) — base nacional mantida pela
 * SEFAZ-RS em nome de todas as UFs. Gratuito, usa o mesmo certificado digital.
 * Único serviço público que traz o indicador de regime tributário do
 * contribuinte (NORMAL = Simples Nacional; GERAL = Regime Normal), além de
 * IE/situação/histórico. Ver Seção 3 da spec (cadastro via certificado + CCC).
 */
@Injectable()
export class CccLookupService {
    private readonly logger = new Logger(CccLookupService.name);
    private readonly parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

    constructor(
        private readonly httpService: HttpService,
        private readonly signatureService: SignatureService,
    ) { }

    async lookup(params: {
        cnpj: string;
        uf: string;
        certificatePfx: string;
        certificatePassword?: string;
    }): Promise<CccLookupResult | null> {
        const { cnpj, uf, certificatePfx, certificatePassword } = params;
        const digits = cnpj.replace(/\D/g, '');

        try {
            const { cert, key } = this.signatureService.getCertAndKey(certificatePfx, certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const body = `<ConsultaCCC xmlns="http://www.sefaz.rs.gov.br/nfe"><UF>${uf}</UF><CNPJ>${digits}</CNPJ></ConsultaCCC>`;
            const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${body}</soap12:Body></soap12:Envelope>`;

            const response$ = this.httpService.post(
                'https://ccc.svrs.rs.gov.br/ws/CCC/CCC.asmx',
                soapEnvelope,
                {
                    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
                    httpsAgent: agent,
                    timeout: 20000,
                },
            ).pipe(timeout(25000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);
            const result = parsed?.Envelope?.Body?.ConsultaCCCResponse?.ConsultaCCCResult;
            if (!result) return null;

            const regimeRaw = String(result.regime || result.Regime || '').toUpperCase();
            const taxRegime: CccLookupResult['taxRegime'] =
                regimeRaw === 'NORMAL' ? 'SIMPLES_NACIONAL' : (regimeRaw === 'GERAL' ? 'NORMAL' : null);

            return {
                ie: result.ie || result.IE,
                situacao: result.situacao || result.Situacao,
                taxRegime,
            };
        } catch (err: any) {
            this.logger.warn(`Falha ao consultar CCC para CNPJ ${digits}: ${err.message}`);
            return null;
        }
    }
}
