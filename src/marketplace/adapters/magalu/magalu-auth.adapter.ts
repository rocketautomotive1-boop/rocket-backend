import { Injectable, HttpException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { resolveRedirectUri } from '../shared/resolve-redirect-uri';

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(64));
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

@Injectable()
export class MagaluAuthAdapter {
  private authUrl = process.env.MAGALU_OAUTH_AUTHORIZE_URL || 'https://id.magalu.com/login';
  private tokenUrl = process.env.MAGALU_OAUTH_TOKEN_URL!;
  private clientId = process.env.MAGALU_CLIENT_ID!;
  private clientSecret = process.env.MAGALU_CLIENT_SECRET!;

  constructor(private readonly marketplaceRegistry: MarketplaceRegistryService) {}

  private async getRedirectUri(): Promise<string> {
    const mkt = await this.marketplaceRegistry.findByTag('magalu').catch(() => null);
    return resolveRedirectUri(mkt, process.env.MAGALU_REDIRECT_URI);
  }

  private encodeScope(scope: string) {
    return scope.trim().split(/\s+/).join('%20');
  }

  async getAuthorizeUrl(state?: string) {
    const scopes =
      (process.env.MAGALU_SCOPES?.trim()) ||
      'openid pa:clients:read pa:clients:update-public pa:api-products:read-apf pa:clients:create-public pa:scopes:read';

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const redirectUri = await this.getRedirectUri();

    const parts = [
      `response_type=code`,
      `client_id=${this.clientId}`,
      `scope=${this.encodeScope(scopes)}`,
      `redirect_uri=${redirectUri}`,
      `code_challenge=${codeChallenge}`,
      `code_challenge_method=S256`,
      `choose_tenants=true`,
    ];
    if (state) parts.push(`state=${state}`);

    return {
      url: `${this.authUrl}?${parts.join('&')}`,
      codeVerifier,
    };
  }

  async exchangeCode(code: string, codeVerifier?: string) {
    try {
      const redirectUri = await this.getRedirectUri();
      // Monta corpo conforme PKCE
      const body: Record<string, string> = {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
        // client_id NÃO vai no corpo quando usamos Basic Auth
      };
      if (codeVerifier) body.code_verifier = codeVerifier;

      // Autenticação do cliente via Basic Auth (requisitado por muitos IdPs)
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const res = await axios.post(this.tokenUrl, new URLSearchParams(body), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
      });
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data || 'Magalu token error', e.response?.status || 500);
    }
  }

  async refreshToken(refreshToken: string) {
    // Também via Basic Auth
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await axios.post(
      this.tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
      },
    );
    return res.data;
  }
}