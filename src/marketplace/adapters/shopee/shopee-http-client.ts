import { Injectable } from '@nestjs/common';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from '../shared/marketplace-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';
import { ShopeeSignerService } from './shopee-signer.service';
import { getShopeeBaseUrl, buildHeaders } from './shopee-utils';

/**
 * Transporte HTTP da Shopee. A assinatura HMAC vai nos QUERY PARAMS (não em
 * header): cada tentativa resolve partner_id/sign/access_token/shop_id via
 * ShopeeSignerService a partir do token resolvido (shopId vem de
 * `token.additionalData.shopId`). O Bearer entra via buildHeaders.
 *
 * auth-retry e resolução de conta ficam na base — o adapter chama
 * request/get/post e não vê token, refresh nem assinatura.
 */
@Injectable()
export class ShopeeHttpClient extends MarketplaceHttpClient {
  constructor(
    authRetry: AuthRetryService,
    marketplaceRegistry: MarketplaceRegistryService,
    private readonly signer: ShopeeSignerService,
  ) {
    super(authRetry, marketplaceRegistry);
  }

  protected marketplaceName(): string {
    return 'Shopee';
  }

  protected baseUrl(): string {
    return getShopeeBaseUrl();
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    const timestamp = Math.floor(Date.now() / 1000);
    const shopId = token.additionalData?.shopId;
    const signedParams = await this.signer.buildSignedParams(
      spec.path,
      timestamp,
      token.accessToken,
      shopId,
      spec.query,
    );

    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: {
        params: signedParams,
        data: spec.body,
        headers: {
          ...buildHeaders(token.accessToken),
          ...(spec.headers ?? {}),
        },
      },
    };
  }
}
