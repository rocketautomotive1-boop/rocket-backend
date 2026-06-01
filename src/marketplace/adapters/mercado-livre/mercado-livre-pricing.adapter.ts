import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';

/** Um listing type da resposta crua de /sites/{SITE}/listing_prices. */
export interface RawListingType {
  currency_id: string;
  listing_type_id: string;
  listing_type_name: string;
  sale_fee_amount?: number;
  sale_fee_details?: {
    percentage_fee?: number;
    fixed_fee?: number;
    gross_amount?: number;
  };
}

/** Resultado normalizado por listing type, com lucro líquido calculado. */
export interface ListingTypeResult {
  listingTypeId: string;
  name: string;
  saleFeeAmount: number;
  percentageFee: number;
  fixedFee: number;
  netProfit: number;
  marginPct: number;
}

/** Os dois tipos de anúncio relevantes para Marketplace BR (Clássico, Premium). */
const RELEVANT_TYPES = ['gold_special', 'gold_pro'] as const;

@Injectable()
export class MercadoLivrePricingAdapter {
  private readonly logger = new Logger(MercadoLivrePricingAdapter.name);
  private readonly baseUrl = 'https://api.mercadolibre.com';
  private readonly site = 'MLB';
  private readonly marketplaceName = 'Mercado Livre';

  constructor(
    @Inject(forwardRef(() => MercadoLivreAuthAdapter))
    private readonly authAdapter: MercadoLivreAuthAdapter,
  ) {}

  /** Lucro líquido = preço − custo − comissão; margem = lucro / preço. */
  computeNetProfit(
    price: number,
    cost: number | undefined,
    saleFeeAmount: number,
  ): { netProfit: number; marginPct: number } {
    const c = cost ?? 0;
    const netProfit = price - c - saleFeeAmount;
    const marginPct = price > 0 ? netProfit / price : 0;
    return { netProfit, marginPct };
  }

  /** Mantém só Clássico/Premium (nessa ordem) e calcula lucro líquido de cada. */
  compareListingTypes(
    raw: RawListingType[],
    price: number,
    cost: number | undefined,
  ): ListingTypeResult[] {
    return RELEVANT_TYPES
      .map((id) => raw.find((r) => r.listing_type_id === id))
      .filter((r): r is RawListingType => !!r)
      .map((r) => {
        const saleFeeAmount = Number.isFinite(r.sale_fee_amount) ? (r.sale_fee_amount as number) : 0;
        const { netProfit, marginPct } = this.computeNetProfit(price, cost, saleFeeAmount);
        return {
          listingTypeId: r.listing_type_id,
          name: r.listing_type_name,
          saleFeeAmount,
          percentageFee: r.sale_fee_details?.percentage_fee ?? 0,
          fixedFee: r.sale_fee_details?.fixed_fee ?? 0,
          netProfit,
          marginPct,
        };
      });
  }

  /**
   * Proxy somente-leitura para /sites/MLB/listing_prices.
   * Retorna sempre um array de listing types crus.
   */
  async getListingPrices(params: {
    price: number;
    categoryId?: string;
    listingTypeId?: string;
  }): Promise<RawListingType[]> {
    const token = await this.authAdapter.getValidToken(this.marketplaceName);

    const query: Record<string, string | number> = { price: params.price };
    if (params.categoryId) query.category_id = params.categoryId;
    if (params.listingTypeId) query.listing_type_id = params.listingTypeId;

    const response = await axios.get(`${this.baseUrl}/sites/${this.site}/listing_prices`, {
      params: query,
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = response.data;
    return Array.isArray(data) ? data : [data];
  }
}
