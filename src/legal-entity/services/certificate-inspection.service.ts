import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SignatureService } from '../../fiscal/services/signature.service';
import { CccLookupService } from '../../document-lookup/adapters/ccc-lookup.service';
import { SefazCadConsultaCadastroAdapter } from '../../document-lookup/adapters/sefaz-cad-consulta-cadastro.adapter';

export interface CertificateInspectionResult {
    cnpj: string;
    companyName: string;
    certificateValidUntil: Date;
    ie?: string;
    taxRegime: 'SIMPLES_NACIONAL' | 'NORMAL' | null;
    address?: { street: string; number: string; neighborhood: string; city: string; state: string; zipCode: string };
    icmsEnabled?: boolean;
    situacao?: string;
}

/**
 * Orquestra a extração de dados a partir do certificado digital + consultas
 * gratuitas SEFAZ (CCC, NFeConsultaCadastro) para pré-preencher o formulário
 * de cadastro da LegalEntity. Ver Seção 3 da spec de completude do ciclo de
 * vida fiscal — não persiste nada, é só leitura/preview.
 */
@Injectable()
export class CertificateInspectionService {
    private readonly logger = new Logger(CertificateInspectionService.name);

    constructor(
        private readonly signatureService: SignatureService,
        private readonly cccLookup: CccLookupService,
        private readonly cadConsultaCadastro: SefazCadConsultaCadastroAdapter,
    ) { }

    async inspect(pfxBase64: string, password: string | undefined, uf: string): Promise<CertificateInspectionResult> {
        let cnpj: string, companyName: string, certificateValidUntil: Date;
        try {
            const extracted = this.signatureService.extractCertificateData(pfxBase64, password);
            cnpj = extracted.cnpj;
            companyName = extracted.companyName;
            certificateValidUntil = extracted.validUntil;
        } catch (err: any) {
            throw new BadRequestException(`Não foi possível ler o certificado: ${err.message}`);
        }

        if (!cnpj || cnpj.length !== 14) {
            throw new BadRequestException('Certificado não contém um CNPJ válido no Subject (esperado um e-CNPJ ICP-Brasil).');
        }

        const [ccc, cadCadastro] = await Promise.all([
            this.cccLookup.lookup({ cnpj, uf, certificatePfx: pfxBase64, certificatePassword: password }).catch((err) => {
                this.logger.warn(`CCC lookup falhou para ${cnpj}: ${err.message}`);
                return null;
            }),
            this.cadConsultaCadastro.consult({ cnpj, uf, certificatePfx: pfxBase64, certificatePassword: password }).catch((err) => {
                this.logger.warn(`CadConsultaCadastro falhou para ${cnpj}: ${err.message}`);
                return null;
            }),
        ]);

        return {
            cnpj,
            companyName,
            certificateValidUntil,
            ie: ccc?.ie || cadCadastro?.ie,
            taxRegime: ccc?.taxRegime ?? null,
            icmsEnabled: cadCadastro?.icmsEnabled,
            situacao: ccc?.situacao || cadCadastro?.situacao,
        };
    }
}
