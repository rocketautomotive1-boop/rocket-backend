import { Injectable } from '@nestjs/common';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { FiscalRate, FiscalRatePort } from '../ports';

@Injectable()
export class FiscalRateAdapter implements FiscalRatePort {
  constructor(private readonly legalEntityService: LegalEntityService) {}

  /** Função pura: override > issuer.effectiveTaxRate > 0. */
  static resolve(issuer: { effectiveTaxRate?: number } | null, override?: number): number {
    if (override != null && override > 0) return override;
    return Number(issuer?.effectiveTaxRate ?? 0);
  }

  async getRate(override?: number): Promise<FiscalRate> {
    const issuer = await this.legalEntityService.findActive();
    return {
      rate: FiscalRateAdapter.resolve(issuer as any, override),
      taxRegime: (issuer as any)?.taxRegime ?? null,
    };
  }
}
