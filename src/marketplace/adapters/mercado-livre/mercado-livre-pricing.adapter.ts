import { Injectable, Logger } from '@nestjs/common';
import { MlHttpClient } from './ml-http-client';

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
  private readonly site = 'MLB';

  constructor(private readonly http: MlHttpClient) {}

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
    const query: Record<string, string | number> = { price: params.price };
    if (params.categoryId) query.category_id = params.categoryId;
    if (params.listingTypeId) query.listing_type_id = params.listingTypeId;

    const data = await this.http.get<any>(
      `/sites/${this.site}/listing_prices`,
      { context: 'getListingPrices' },
      query,
    );
    return Array.isArray(data) ? data : [data];
  }

  /**
   * Sugere o preço de venda que atinge `targetMargin` para um dado custo.
   * Busca binária no preço; a fee é reconsultada a cada candidato via `feeLookup`.
   * Retorna `{ suggestedPrice: null, converged: false }` se a margem não for
   * atingível na faixa (mesmo no `maxPrice` a margem fica abaixo do alvo).
   *
   * `converged` indica se o preço retornado está dentro da tolerância (0.5%) do
   * alvo. Pode vir `false` se as 25 iterações se esgotarem — o que pode ocorrer
   * se a curva de fee da ML não for monotônica (ex.: caps/floors por categoria).
   * Nesse caso o preço é o melhor esforço e um aviso é logado.
   *
   * `feeLookup(price)` deve retornar o sale_fee_amount para aquele preço.
   * Limitado a 25 iterações (≈ precisão de centavos em faixas usuais).
   */
  async suggestPriceForMargin(opts: {
    cost: number;
    targetMargin: number;
    feeLookup: (price: number) => Promise<number>;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<{ suggestedPrice: number | null; converged: boolean }> {
    const { cost, targetMargin, feeLookup } = opts;
    let lo = opts.minPrice ?? Math.max(cost, 1);
    let hi = opts.maxPrice ?? Math.max(cost * 10, 1000);

    const marginAt = async (price: number): Promise<number> => {
      const fee = await feeLookup(price);
      return (price - cost - fee) / price; // price > 0 guaranteed by lo >= 1
    };

    // If even the max price can't reach the target, it's unreachable.
    if ((await marginAt(hi)) < targetMargin) {
      return { suggestedPrice: null, converged: false };
    }

    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      const margin = await marginAt(mid);
      if (Math.abs(margin - targetMargin) <= 0.005) {
        return { suggestedPrice: Math.round(mid * 100) / 100, converged: true };
      }
      if (margin < targetMargin) lo = mid;
      else hi = mid;
    }

    // Fallthrough after 25 iterations: best effort. Verify and warn if off-target
    // (can happen with non-monotonic ML fee curves).
    const finalPrice = Math.round(((lo + hi) / 2) * 100) / 100;
    const finalMargin = await marginAt(finalPrice);
    const converged = Math.abs(finalMargin - targetMargin) <= 0.005;
    if (!converged) {
      this.logger.warn(
        `suggestPriceForMargin não convergiu: margem ${finalMargin.toFixed(4)} vs alvo ${targetMargin} (preço ${finalPrice})`,
      );
    }
    return { suggestedPrice: finalPrice, converged };
  }
}
