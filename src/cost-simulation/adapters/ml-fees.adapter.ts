import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { ListingTypeId, LogisticType } from '../cost-simulation.types';
import { Commission, MarketplaceFeesPort } from '../ports';

const ML_BASE = 'https://api.mercadolibre.com';

@Injectable()
export class MlFeesAdapter implements MarketplaceFeesPort {
  private readonly logger = new Logger(MlFeesAdapter.name);
  private sellerIdCache: string | null = null;
  private commissionCache = new Map<string, { value: Commission; exp: number }>();

  constructor(
    private readonly marketplaceAuthService: MarketplaceAuthService,
    private readonly marketplaceService: MarketplaceService,
  ) {}

  // ── parsing puro (testável sem rede) ──
  static parseCommission(payload: any, listingTypeId?: ListingTypeId): Commission {
    const arr = Array.isArray(payload) ? payload : [payload];
    const chosen = (listingTypeId && arr.find((p) => p?.listing_type_id === listingTypeId)) || arr[0];
    const pct = Number(chosen?.sale_fee_details?.percentage_fee ?? 0);
    return {
      saleFeeAmount: Number(chosen?.sale_fee_amount ?? 0),
      commissionRate: pct / 100,
      fixedFee: Number(chosen?.sale_fee_details?.fixed_fee ?? 0),
      listingTypeId: chosen?.listing_type_id ?? listingTypeId ?? 'gold_special',
    };
  }

  static parseShipping(payload: any): number {
    const cov = payload?.coverage?.all_country;
    if (!cov) return 0;
    const promoted = cov?.discount?.promoted_amount;
    if (promoted != null) return Number(promoted);
    return Number(cov.list_cost ?? 0);
  }

  private async token(): Promise<string> {
    const mp = await this.marketplaceService.findByName('Mercado Livre');
    if (!mp) throw new Error('Marketplace Mercado Livre não encontrado');
    const t = await this.marketplaceAuthService.ensureValidToken(mp._id);
    return t.accessToken;
  }

  async resolveSellerId(): Promise<string | null> {
    if (this.sellerIdCache) return this.sellerIdCache;
    try {
      const { data } = await axios.get(`${ML_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
      });
      this.sellerIdCache = data?.id ? String(data.id) : null;
      return this.sellerIdCache;
    } catch (e: any) {
      this.logger.warn(`resolveSellerId falhou: ${e.message}`);
      return null;
    }
  }

  async getCommission(params: { price: number; listingTypeId: ListingTypeId; categoryId?: string }): Promise<Commission> {
    const key = `${Math.round(params.price)}|${params.listingTypeId}|${params.categoryId ?? ''}`;
    const hit = this.commissionCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;

    const qs = new URLSearchParams({ price: String(params.price), listing_type_id: params.listingTypeId });
    if (params.categoryId) qs.set('category_id', params.categoryId);
    const { data } = await axios.get(`${ML_BASE}/sites/MLB/listing_prices?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
    });
    const parsed = MlFeesAdapter.parseCommission(data, params.listingTypeId);
    this.commissionCache.set(key, { value: parsed, exp: Date.now() + 5 * 60_000 });
    return parsed;
  }

  async getShipping(params: { sellerId: string; dimensions?: string; logisticType: LogisticType }): Promise<number> {
    if (!params.dimensions || !params.sellerId) return 0;
    const qs = new URLSearchParams({ dimensions: params.dimensions, logistic_type: params.logisticType });
    const url = `${ML_BASE}/users/${params.sellerId}/shipping_options/free?${qs.toString()}`;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
      });
      return MlFeesAdapter.parseShipping(data);
    } catch (e: any) {
      this.logger.warn(`Frete ML indisponível (${params.logisticType}): ${e.message}`);
      return 0;
    }
  }
}
