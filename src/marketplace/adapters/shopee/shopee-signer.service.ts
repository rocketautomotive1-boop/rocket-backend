import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';

/**
 * Assina requisições Shopee resolvendo partnerId/partnerKey via
 * MarketplaceCredentialsService (marketplaces.credentials cifrado → env
 * fallback MP_SHOPEE_*). Substitui os helpers baseados em process.env de
 * shopee-utils.ts — nenhum caller deve ler env de credencial diretamente.
 */
@Injectable()
export class ShopeeSignerService {
  constructor(private readonly credentials: MarketplaceCredentialsService) {}

  async getPartnerId(): Promise<string> {
    return this.credentials.getRequired('shopee', 'partnerId');
  }

  async sign(
    path: string,
    timestamp: number,
    accessToken?: string,
    shopId?: string | number,
  ): Promise<string> {
    const partnerId = await this.credentials.getRequired('shopee', 'partnerId');
    const partnerKey = await this.credentials.getRequired('shopee', 'partnerKey');
    const fullPath = path.startsWith('/api/v2') ? path : `/api/v2${path}`;
    const base =
      accessToken && shopId !== undefined && shopId !== null
        ? `${partnerId}${fullPath}${timestamp}${accessToken}${shopId}`
        : `${partnerId}${fullPath}${timestamp}`;
    return createHmac('sha256', partnerKey).update(base).digest('hex');
  }

  async buildSignedParams(
    path: string,
    timestamp: number,
    accessToken?: string,
    shopId?: string | number,
    extra?: Record<string, any>,
  ): Promise<Record<string, any>> {
    const partnerId = await this.credentials.getRequired('shopee', 'partnerId');
    const sign = await this.sign(
      path,
      timestamp,
      accessToken,
      shopId !== undefined && shopId !== null ? String(shopId) : undefined,
    );
    const params: Record<string, any> = {
      partner_id: parseInt(partnerId),
      timestamp,
      sign,
    };
    if (accessToken) params['access_token'] = accessToken;
    if (shopId !== undefined && shopId !== null) {
      const normalizedShopId = parseInt(String(shopId));
      params['shop_id'] = isNaN(normalizedShopId) ? shopId : normalizedShopId;
    }
    if (extra) Object.assign(params, extra);
    return params;
  }
}
