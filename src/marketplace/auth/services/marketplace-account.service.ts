// backend/src/marketplace/auth/services/marketplace-account.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { MarketplaceAccountRepository } from './marketplace-account.repository';
import { MarketplaceAccountModel } from '../schemas/marketplace-account.schema';
import { encrypt } from './credentials-crypto.helper';

interface RegisterAccountInput {
  marketplaceId: string;
  label: string;
  domains: string[];
  credentials?: Record<string, string>;
}

/**
 * Resolução e cadastro de contas de marketplace (multi-client).
 * accountFor: conta do domínio → fallback à default. registerAccount: criptografa
 * credentials antes de persistir. NÃO faz refresh OAuth (Fatia 3).
 */
@Injectable()
export class MarketplaceAccountService {
  constructor(private readonly repo: MarketplaceAccountRepository) {}

  async accountFor(marketplaceId: string, domain: string): Promise<MarketplaceAccountModel | null> {
    const byDomain = await this.repo.findByDomain(marketplaceId, domain);
    if (byDomain) return byDomain;
    return this.repo.findDefault(marketplaceId);
  }

  async registerAccount(input: RegisterAccountInput): Promise<MarketplaceAccountModel> {
    if (!input.label?.trim()) throw new BadRequestException('label da conta é obrigatório.');
    if (!input.domains?.length) throw new BadRequestException('domains da conta é obrigatório.');

    const credentials = this.encryptCredentials(input.credentials ?? {});
    return this.repo.createAccount({
      marketplaceId: input.marketplaceId as any,
      label: input.label,
      domains: input.domains,
      credentials,
    });
  }

  private encryptCredentials(raw: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v) out[k] = encrypt(v);
    }
    return out;
  }
}
