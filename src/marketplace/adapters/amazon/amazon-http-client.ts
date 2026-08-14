import { Injectable } from '@nestjs/common';
import * as aws4 from 'aws4';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from '../shared/marketplace-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';

/**
 * Transporte HTTP da Amazon SP-API. Auth = AWS SigV4 (aws4.sign) + LWA token no
 * header `x-amz-access-token`. As credenciais AWS (accessKeyId/secretAccessKey/
 * region/endpoint) vêm em `token.additionalData` (resolveAwsCredentials), então
 * o client NÃO lê env — é o TokenManager que resolve.
 *
 * A query é embutida na PATH antes de assinar (SigV4 cobre a query string), por
 * isso não usamos `config.params`. auth-retry e resolução de conta ficam na base
 * — o adapter chama request/get/post e não vê token, refresh, aws4 nem env.
 */
@Injectable()
export class AmazonHttpClient extends MarketplaceHttpClient {
  // Constructor explícito OBRIGATÓRIO (emitDecoratorMetadata): sem ele a
  // subclasse @Injectable() não emite design:paramtypes e o Nest injeta deps
  // como undefined. Ver MlHttpClient.
  constructor(authRetry: AuthRetryService, marketplaceRegistry: MarketplaceRegistryService) {
    super(authRetry, marketplaceRegistry);
  }

  protected marketplaceName(): string {
    return 'Amazon';
  }

  /** Endpoint vem do token (env via resolveAwsCredentials); fallback p/ NA. */
  protected baseUrl(): string {
    return 'https://sellingpartnerapi-na.amazon.com';
  }

  protected async sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest> {
    const add = token.additionalData ?? {};
    const accessKeyId = add.accessKeyId;
    const secretAccessKey = add.secretAccessKey;
    const region = add.region || 'us-east-1';
    const endpoint = add.endpoint || this.baseUrl();

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Credenciais AWS (accessKeyId/secretAccessKey) ausentes no token resolvido para Amazon SP-API.');
    }

    // Query embutida na path: SigV4 assina a query string, então ela precisa
    // estar na URL canônica (não em config.params, que o axios re-appenda).
    const qs = spec.query ? new URLSearchParams(this.normalizeQuery(spec.query)).toString() : '';
    const pathWithQuery = qs ? `${spec.path}?${qs}` : spec.path;

    const host = new URL(endpoint).host;
    const hasBody = spec.body !== undefined && spec.body !== null;

    const headers: Record<string, string> = {
      ...(token.accessToken ? { 'x-amz-access-token': token.accessToken } : {}),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(spec.headers ?? {}),
    };

    const request: aws4.Request = {
      host,
      path: pathWithQuery,
      service: 'execute-api',
      region,
      method: String(spec.method),
      headers,
      ...(hasBody ? { body: JSON.stringify(spec.body) } : {}),
    };

    aws4.sign(request, { accessKeyId, secretAccessKey });

    return {
      url: `${endpoint}${pathWithQuery}`,
      config: {
        // body já vai como objeto (axios serializa) — o SigV4 assinou o mesmo JSON.
        data: hasBody ? spec.body : undefined,
        headers: request.headers as Record<string, string>,
      },
    };
  }

  /** URLSearchParams precisa de strings; coage números/booleans. */
  private normalizeQuery(query: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      out[k] = String(v);
    }
    return out;
  }
}
