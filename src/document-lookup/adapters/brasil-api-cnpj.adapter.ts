import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CnpjLookupPort, CnpjLookupResult } from '../ports/cnpj-lookup.port';

const SITUACAO_MAP: Record<string, CnpjLookupResult['situacao']> = {
    ATIVA: 'ATIVA',
    BAIXADA: 'BAIXADA',
    SUSPENSA: 'SUSPENSA',
    INAPTA: 'INATIVA',
    NULA: 'INATIVA',
};

/** CNPJ lookup gratuito, sem contrato — https://brasilapi.com.br/api/cnpj/v1/:cnpj */
@Injectable()
export class BrasilApiCnpjAdapter implements CnpjLookupPort {
    private readonly logger = new Logger(BrasilApiCnpjAdapter.name);

    constructor(private readonly httpService: HttpService) { }

    async lookup(cnpj: string): Promise<CnpjLookupResult | null> {
        const digits = cnpj.replace(/\D/g, '');
        try {
            const response = await firstValueFrom(
                this.httpService.get(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { timeout: 10000 }),
            );
            const data = response.data;
            return {
                cnpj: digits,
                companyName: data.razao_social || '',
                fantasyName: data.nome_fantasia || undefined,
                address: {
                    street: data.logradouro || '',
                    number: data.numero || '',
                    neighborhood: data.bairro || '',
                    city: data.municipio || '',
                    state: data.uf || '',
                    zipCode: (data.cep || '').replace(/\D/g, ''),
                },
                situacao: SITUACAO_MAP[data.descricao_situacao_cadastral] || 'INATIVA',
            };
        } catch (err: any) {
            if (err?.response?.status === 404) return null;
            this.logger.warn(`Falha ao consultar CNPJ ${digits} na BrasilAPI: ${err.message}`);
            return null;
        }
    }
}
