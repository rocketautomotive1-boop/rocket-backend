import { Injectable } from '@nestjs/common';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from '../shared/marketplace-http-client';
import { ResolvedToken } from '../../auth/services/token-manager.service';

/**
 * Transporte HTTP do Mercado Livre. Auth = Bearer simples; auth-retry e
 * resolução de conta ficam na base (invisíveis ao adapter).
 */
@Injectable()
export class MlHttpClient extends MarketplaceHttpClient {
  protected marketplaceName(): string {
    return 'Mercado Livre';
  }

  protected baseUrl(): string {
    return 'https://api.mercadolibre.com';
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: {
        params: spec.query,
        data: spec.body,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          ...(spec.headers ?? {}),
        },
      },
    };
  }
}
