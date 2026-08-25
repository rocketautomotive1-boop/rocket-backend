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
 * Transporte HTTP do Mercado Livre. Auth = Bearer simples; auth-retry e
 * resolução de conta ficam na base (invisíveis ao adapter).
 */
@Injectable()
export class MlHttpClient extends MarketplaceHttpClient {
  // Constructor explícito OBRIGATÓRIO: sem ele, a subclasse @Injectable() não
  // emite design:paramtypes e o Nest instancia sem deps (authRetry/registry
  // viram undefined → "Cannot read properties of undefined (reading 'findByName')").
  constructor(authRetry: AuthRetryService, marketplaceRegistry: MarketplaceRegistryService) {
    super(authRetry, marketplaceRegistry);
  }

  protected marketplaceName(): string {
    return 'Mercado Livre';
  }

  protected baseUrl(): string {
    return 'https://api.mercadolibre.com';
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    // spec.body já vem resolvido (a factory de MarketplaceHttpClient.request roda
    // antes de sign()) — quando é um FormData (form-data), os headers precisam vir
    // DESSA mesma instância (boundary é gerado por instância), não de spec.headers
    // estático, senão o boundary do header não bate com o do corpo enviado.
    const formHeaders = typeof spec.body?.getHeaders === 'function' ? spec.body.getHeaders() : undefined;
    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: {
        params: spec.query,
        data: spec.body,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          ...formHeaders,
          ...(spec.headers ?? {}),
        },
      },
    };
  }
}
