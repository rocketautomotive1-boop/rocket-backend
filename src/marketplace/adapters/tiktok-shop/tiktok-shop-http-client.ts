import { Injectable } from '@nestjs/common';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from '../shared/marketplace-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';
import { getTikTokShopBaseUrl, buildSignedParams, buildHeaders } from './tiktok-shop-utils';

/**
 * Transporte HTTP do TikTok Shop. A assinatura HMAC vai nos QUERY PARAMS:
 * buildSignedParams resolve app_key/sign/timestamp/shop_cipher/access_token a
 * partir do token resolvido (shopCipher vem de `token.additionalData.shopCipher`).
 * O access token também entra no header `x-tts-access-token` (buildHeaders).
 *
 * A assinatura é calculada sobre o BODY SERIALIZADO, então `sign` serializa o
 * body do jeito que o axios envia (JSON.stringify do objeto). auth-retry e
 * resolução de conta ficam na base — o adapter não vê token, refresh nem sign.
 */
@Injectable()
export class TikTokShopHttpClient extends MarketplaceHttpClient {
  // Constructor explícito OBRIGATÓRIO (emitDecoratorMetadata). Ver MlHttpClient.
  constructor(authRetry: AuthRetryService, marketplaceRegistry: MarketplaceRegistryService) {
    super(authRetry, marketplaceRegistry);
  }

  protected marketplaceName(): string {
    return 'TikTok Shop';
  }

  protected baseUrl(): string {
    return getTikTokShopBaseUrl();
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    const timestamp = Math.floor(Date.now() / 1000);
    const shopCipher = token.additionalData?.shopCipher;
    const hasBody = spec.body !== undefined && spec.body !== null;
    // A assinatura cobre o body serializado — precisa bater com o que o axios envia.
    const bodyStr = hasBody ? JSON.stringify(spec.body) : undefined;

    const params = buildSignedParams(
      spec.path,
      timestamp,
      token.accessToken ?? undefined,
      shopCipher,
      spec.query,
      bodyStr,
    );

    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: {
        params,
        data: hasBody ? spec.body : undefined,
        headers: {
          ...buildHeaders(token.accessToken ?? undefined),
          ...(spec.headers ?? {}),
        },
      },
    };
  }
}
