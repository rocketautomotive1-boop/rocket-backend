import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import * as aws4 from 'aws4';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';

/**
 * Assinatura de requests de marketplace NO BACKEND — o segredo (partnerKey/
 * appSecret/awsSecretKey) NUNCA sai daqui. O orchestrator manda só os parâmetros
 * públicos (path, timestamp, accessToken, etc.) e recebe a assinatura/headers
 * prontos. Substitui o antigo getCredentials() cru do orchestrator.
 *
 * Segredos resolvidos via MarketplaceCredentialsService (marketplaces.credentials
 * cifrado + fallback env MP_<TAG>_<KEY>).
 */
@Injectable()
export class MarketplaceSignerService {
  constructor(private readonly credentials: MarketplaceCredentialsService) {}

  /** Roteia por tag. Lança se a tag não tem assinatura suportada. */
  async sign(tag: string, payload: Record<string, any>): Promise<Record<string, any>> {
    switch (tag) {
      case 'shopee':
        return this.signShopee(payload as any);
      case 'tiktokshop':
        return this.signTikTok(payload as any);
      case 'amazon':
        return this.signAmazon(payload as any);
      default:
        throw new BadRequestException(`Assinatura não suportada para marketplace '${tag}'.`);
    }
  }

  // ── Shopee: HMAC-SHA256, chave = partnerKey ────────────────────────────────
  private async signShopee(p: {
    path: string;
    timestamp: number;
    accessToken?: string;
    shopId?: string | number;
    extra?: Record<string, any>;
  }): Promise<{ params: Record<string, any> }> {
    const partnerId = await this.credentials.getRequired('shopee', 'partnerId');
    const partnerKey = await this.credentials.getRequired('shopee', 'partnerKey');

    const fullPath = p.path.startsWith('/api/v2') ? p.path : `/api/v2${p.path}`;
    const shopIdStr = p.shopId !== undefined && p.shopId !== null ? String(p.shopId) : undefined;
    const base = p.accessToken && shopIdStr
      ? `${partnerId}${fullPath}${p.timestamp}${p.accessToken}${shopIdStr}`
      : `${partnerId}${fullPath}${p.timestamp}`;
    const sign = createHmac('sha256', partnerKey).update(base).digest('hex');

    const params: Record<string, any> = { partner_id: parseInt(String(partnerId)), timestamp: p.timestamp, sign };
    if (p.accessToken) params.access_token = p.accessToken;
    if (shopIdStr !== undefined) {
      const n = parseInt(shopIdStr);
      params.shop_id = isNaN(n) ? p.shopId : n;
    }
    if (p.extra) Object.assign(params, p.extra);
    return { params };
  }

  // ── TikTok Shop: HMAC-SHA256, chave = appSecret (wrapped) ──────────────────
  private async signTikTok(p: {
    path: string;
    timestamp: number;
    accessToken?: string;
    shopCipher?: string;
    extra?: Record<string, any>;
    body?: string;
  }): Promise<{ params: Record<string, any> }> {
    const appKey = await this.credentials.getRequired('tiktokshop', 'appKey');
    const appSecret = await this.credentials.getRequired('tiktokshop', 'appSecret');

    const baseParams: Record<string, any> = { app_key: appKey, timestamp: p.timestamp };
    if (p.shopCipher) baseParams.shop_cipher = p.shopCipher;
    if (p.extra) Object.assign(baseParams, p.extra);

    const filtered = { ...baseParams };
    delete filtered.sign;
    delete filtered.access_token;
    const paramString = Object.keys(filtered).sort().map((k) => `${k}${filtered[k]}`).join('');
    const content = `${p.path}${paramString}${p.body || ''}`;
    const wrapped = `${appSecret}${content}${appSecret}`;
    const sign = createHmac('sha256', appSecret).update(wrapped).digest('hex');

    const params: Record<string, any> = { ...baseParams, sign };
    if (p.accessToken) params.access_token = p.accessToken;
    return { params };
  }

  // ── Amazon SP-API: SigV4 (aws4), segredo = awsSecretKey ────────────────────
  private async signAmazon(p: {
    method: string;
    host: string;
    path: string; // inclui query string
    accessToken?: string;
    body?: string;
    region?: string;
  }): Promise<{ headers: Record<string, string> }> {
    const accessKeyId = await this.credentials.getRequired('amazon', 'awsAccessKey');
    const secretAccessKey = await this.credentials.getRequired('amazon', 'awsSecretKey');
    const region = p.region || process.env.AMAZON_AWS_REGION || process.env.AWS_REGION || 'us-east-1';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (p.accessToken) headers['x-amz-access-token'] = p.accessToken;

    const request: aws4.Request = {
      host: p.host,
      path: p.path,
      method: p.method,
      headers,
      body: p.body,
      region,
      service: 'execute-api',
    };
    aws4.sign(request, { accessKeyId, secretAccessKey });
    return { headers: request.headers as Record<string, string> };
  }
}
