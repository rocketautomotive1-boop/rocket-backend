import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { ListingTypeId, LogisticType } from '../cost-simulation.types';
import { Commission, MarketplaceFeesPort } from '../ports';
import { lookupShipping, reputationBucket, shippingModeFor, ShippingReputation } from '../ml-shipping-table';

const ML_BASE = 'https://api.mercadolibre.com';

@Injectable()
export class MlFeesAdapter implements MarketplaceFeesPort {
  private readonly logger = new Logger(MlFeesAdapter.name);
  private sellerIdCache: string | null = null;
  private reputationCache: ShippingReputation | null = null;
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

  private async token(): Promise<string> {
    const mp = await this.marketplaceService.findByName('Mercado Livre');
    if (!mp) throw new Error('Marketplace Mercado Livre não encontrado');
    const t = await this.marketplaceAuthService.ensureValidToken(mp._id);
    return t.accessToken;
  }

  /** Uma chamada /users/me popula sellerId + reputação. */
  private async loadMe(): Promise<void> {
    if (this.sellerIdCache && this.reputationCache) return;
    try {
      const { data } = await axios.get(`${ML_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
      });
      this.sellerIdCache = data?.id ? String(data.id) : null;
      this.reputationCache = reputationBucket(data?.seller_reputation?.level_id);
    } catch (e: any) {
      this.logger.warn(`/users/me falhou: ${e.message}`);
    }
  }

  async resolveSellerId(): Promise<string | null> {
    await this.loadMe();
    return this.sellerIdCache;
  }

  async resolveReputation(): Promise<ShippingReputation> {
    await this.loadMe();
    return this.reputationCache ?? 'green';
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

  /**
   * Frete pela TABELA oficial do ML. O endpoint shipping_options retorna valor
   * inconsistente (R$0,50 fixo) e não recebe preço — por isso usamos a tabela.
   * fulfillment → tabela Full Super; demais → tabela Tradicional (por reputação).
   */
  async getShipping(params: { weightKg: number; price: number; reputation: ShippingReputation; logisticType: LogisticType }): Promise<number | null> {
    return lookupShipping({
      mode: shippingModeFor(params.logisticType),
      reputation: params.reputation,
      weightKg: params.weightKg,
      price: params.price,
    });
  }
}
