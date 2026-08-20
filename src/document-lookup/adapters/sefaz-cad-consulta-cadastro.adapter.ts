import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { lastValueFrom, timeout } from 'rxjs';
import { SignatureService } from '../../fiscal/services/signature.service';

export interface CadConsultaCadastroResult {
    ie?: string;
    icmsEnabled: boolean;
    companyName?: string;
    situacao?: string;
}

/**
 * Consulta Cadastro de Contribuintes (CadConsultaCadastro4), servida via SVRS
 * (Sefaz Virtual do RS) para a maioria das UFs, incluindo PE. Gratuito, sem
 * contrato — usa o mesmo certificado digital já configurado em LegalEntity.
 * Verifica se o CNPJ/IE está habilitado como contribuinte de ICMS na UF de
 * destino, evitando rejeição da SEFAZ por IE inválida/desabilitada na transmissão.
 */
@Injectable()
export class SefazCadConsultaCadastroAdapter {
    private readonly logger = new Logger(SefazCadConsultaCadastroAdapter.name);
    private readonly parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

    constructor(
        private readonly httpService: HttpService,
        private readonly signatureService: SignatureService,
    ) { }

    async consult(params: {
        cnpj: string;
        uf: string;
        certificatePfx: string;
        certificatePassword?: string;
    }): Promise<CadConsultaCadastroResult | null> {
        const { cnpj, uf, certificatePfx, certificatePassword } = params;
        const digits = cnpj.replace(/\D/g, '');

        try {
            const { cert, key } = this.signatureService.getCertAndKey(certificatePfx, certificatePassword);
            const agent = new https.Agent({ cert, key, rejectUnauthorized: false });

            const body = `<consCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>${uf}</UF><CNPJ>${digits}</CNPJ></infCons></consCad>`;
            const soapEnvelope = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:cad="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4"><soap12:Header/><soap12:Body><cad:nfeDadosMsg>${body}</cad:nfeDadosMsg></soap12:Body></soap12:Envelope>`;

            const response$ = this.httpService.post(
                'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
                soapEnvelope,
                {
                    headers: {
                        'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/cadConsultaCadastro"',
                    },
                    httpsAgent: agent,
                    timeout: 20000,
                },
            ).pipe(timeout(25000));

            const response = await lastValueFrom(response$);
            const parsed = this.parser.parse(response.data);
            const retConsCad = parsed?.Envelope?.Body?.nfeResultMsg?.retConsCad;
            const infCons = retConsCad?.infCons;

            if (!infCons || infCons.cStat != 111) {
                // 111 = consulta cadastro com sucesso; qualquer outro cStat indica não encontrado/erro
                return null;
            }

            const contribuinte = Array.isArray(infCons.infCad) ? infCons.infCad[0] : infCons.infCad;
            if (!contribuinte) return null;

            return {
                ie: contribuinte.IE,
                icmsEnabled: contribuinte.situacao === 'ATIVO' || contribuinte.SITUACAO === 'ATIVO',
                companyName: contribuinte.xNome,
                situacao: contribuinte.situacao || contribuinte.SITUACAO,
            };
        } catch (err: any) {
            this.logger.warn(`Falha ao consultar CadConsultaCadastro para CNPJ ${digits}: ${err.message}`);
            return null;
        }
    }
}
