import { Injectable } from '@nestjs/common';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from '../shared/marketplace-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';

/**
 * Transporte HTTP do Magalu. Auth = Bearer simples (igual ML) — sem HMAC,
 * sem SigV4; auth-retry e resolução de conta ficam na base.
 */
@Injectable()
export class MagaluHttpClient extends MarketplaceHttpClient {
  // Constructor explícito OBRIGATÓRIO: sem ele, a subclasse @Injectable() não
  // emite design:paramtypes e o Nest instancia sem deps (mesmo cuidado do
  // MlHttpClient — ver comentário lá).
  constructor(authRetry: AuthRetryService, marketplaceRegistry: MarketplaceRegistryService) {
    super(authRetry, marketplaceRegistry);
  }

  protected marketplaceName(): string {
    return 'Magalu';
  }

  protected baseUrl(): string {
    return 'https://api.magalu.com';
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: {
        params: spec.query,
        data: spec.body,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(spec.headers ?? {}),
        },
      },
    };
  }
}
