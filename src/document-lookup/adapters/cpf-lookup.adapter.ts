import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CpfLookupPort, CpfLookupResult } from '../ports/cpf-lookup.port';

/**
 * Stub — nenhum provedor de consulta CPF→dados é gratuito (LGPD exige base legal +
 * credencial paga: SERPRO oficial ou revendedores como Infosimples/ValidaSeguro/DirectD).
 * Contratação é decisão comercial fora do escopo de engenharia — este adapter recusa
 * graciosamente até CPF_LOOKUP_PROVIDER ser configurado. Trocar por uma implementação
 * real é mecânico: todos os provedores seguem o mesmo shape (documento → nome/endereço).
 */
@Injectable()
export class CpfLookupAdapter implements CpfLookupPort {
    constructor(private readonly configService: ConfigService) { }

    async lookup(cpf: string, birthDate?: string): Promise<CpfLookupResult | null> {
        const provider = this.configService.get<string>('CPF_LOOKUP_PROVIDER');
        if (!provider) {
            throw new ServiceUnavailableException(
                'Consulta de CPF não configurada — contrate um provedor (SERPRO, Infosimples, ValidaSeguro, DirectD) e configure CPF_LOOKUP_PROVIDER.',
            );
        }
        throw new ServiceUnavailableException(`Provedor de CPF '${provider}' configurado mas sem adapter implementado ainda.`);
    }
}
