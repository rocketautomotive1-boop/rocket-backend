import { Injectable, Logger } from '@nestjs/common';
import { OrderMarketplaceDetailsService, MarketplaceFinancialCharge } from './order-marketplace-details.service';
import { OrderPricingDetailDto } from '../dto/order-pricing-detail.dto';

export interface OrderFinancialSummary {
  gross: number;
  saleFee: number;
  freight: number;
  coupon: number;
  taxes: number;
  net: number;
  costTotal: number;
  grossProfit: number;
  marginPct: number;
  /** Breakdown detalhado de cobranças (ML billing API) */
  charges: MarketplaceFinancialCharge[];
  /** Breakdown de impostos (ML billing API) */
  taxDetails: { name: string; amount: number }[];
}

/**
 * Centraliza a busca e normalização de dados financeiros de um pedido.
 * Mesma lógica de prioridade do FinancialCard no app:
 *   billingDetails (ML) → marketplaceDetails.financial → order.payment → pricing (estimado)
 */
@Injectable()
export class OrderFinancialSummaryService {
  private readonly logger = new Logger(OrderFinancialSummaryService.name);

  constructor(
    private readonly marketplaceDetailsService: OrderMarketplaceDetailsService,
  ) {}

  async getFinancialSummary(
    order: any,
    pricing: OrderPricingDetailDto,
  ): Promise<OrderFinancialSummary> {
    const orderId = order._id?.toString() ?? order.id;
    const p = order.payment ?? {};
    const { totals } = pricing;

    let mfGross = 0, mfSaleFee = 0, mfFreight = 0, mfCoupon = 0, mfTaxes = 0, mfNet = 0;
    let bdSaleFee = 0;
    let charges: MarketplaceFinancialCharge[] = [];
    let taxDetails: { name: string; amount: number }[] = [];

    // ── Fetch marketplace details (getDetails) ──────────────────────────────
    try {
      const details = await this.marketplaceDetailsService.getDetails(orderId);
      const mf = details?.financial;
      const ms = details?.shipping;

      if (mf) {
        mfGross   = Number(mf.grossAmount   ?? 0);
        mfSaleFee = Number(mf.saleFee       ?? 0);
        mfFreight = Number(ms?.listCost     ?? mf.freightCost ?? 0);
        mfCoupon  = Number(mf.couponAmount  ?? 0);
        mfTaxes   = Number(mf.taxesAmount   ?? 0);
        mfNet     = Number(mf.netAmount     ?? 0);
        charges   = mf.charges ?? [];
      }
    } catch (err) {
      this.logger.warn(`[FinancialSummary] getDetails failed for ${orderId}: ${err.message}`);
    }

    // ── Fetch ML billing details (most accurate for ML orders) ──────────────
    try {
      const billing = await this.marketplaceDetailsService.getMlBillingDetails(orderId);
      if (billing?.supported && billing?.data) {
        const bd = billing.data;
        bdSaleFee  = Number(bd.saleFee?.gross ?? 0);
        charges    = bd.charges   ?? charges;
        taxDetails = bd.taxDetails ?? [];
      }
    } catch (err) {
      this.logger.warn(`[FinancialSummary] getMlBillingDetails failed for ${orderId}: ${err.message}`);
    }

    const isMercadoLivre = String(pricing.marketplace ?? '').toLowerCase().includes('mercado');

    // ── Merge: billing > marketplaceDetails > order.payment > pricing ────────
    const grossFromPayment = Number(p.grossAmount || 0);
    const grossFromPricing = Number(totals.grossRevenue || order.totalAmount || 0);
    const originalGross = mfGross || grossFromPayment || grossFromPricing;

    let gross = originalGross;
    let saleFee = bdSaleFee || mfSaleFee || Number(p.marketplaceFee || totals.totalCommission || 0);
    const freight = mfFreight || Number(order.shippingAmount || totals.totalFreight || 0);
    let coupon  = mfCoupon  || Number(p.couponAmount   || 0);
    const taxes   = mfTaxes   || Number(p.taxAmount      || totals.totalTaxes || 0);
    let net     = mfNet     || Number(p.netAmount      || Math.max(0, gross - saleFee - freight - coupon - taxes));
    const costTotal = totals.totalCostOfGoods ?? 0;

    // Legacy ML payloads can persist sale_fee as unitary value (single item) instead of total.
    // If quantity scaling matches pricing.totalCommission, promote it to the total fee.
    const totalQty = (order.items ?? []).reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0);
    const pricingCommission = Number(totals.totalCommission || 0);
    if (
      isMercadoLivre &&
      !bdSaleFee &&
      saleFee > 0 &&
      totalQty > 1 &&
      pricingCommission > 0 &&
      Math.abs((saleFee * totalQty) - pricingCommission) < 0.01
    ) {
      saleFee = pricingCommission;
      net = Math.max(0, gross - saleFee - freight - coupon - taxes);
    }

    // ML coupon can come as buyer discount (marketplace-funded), not seller deduction.
    // In this case pricing gross is full product price and details may bring "total paid" only.
    if (
      isMercadoLivre &&
      coupon > 0 &&
      grossFromPricing > 0 &&
      grossFromPricing > gross &&
      Math.abs((gross + coupon) - grossFromPricing) < 0.01
    ) {
      gross = grossFromPricing;
      const baselineNet = Math.max(0, gross - saleFee - freight - taxes);
      const netGap = baselineNet - net;

      // Bug pattern: gross reduced by coupon and net reduced by coupon again.
      if (Math.abs(netGap - coupon * 2) < 0.01) {
        net = baselineNet;
        coupon = 0;
      }
    }

    const grossProfit = net - costTotal;
    const marginPct   = gross > 0 ? (grossProfit / gross) * 100 : 0;

    return { gross, saleFee, freight, coupon, taxes, net, costTotal, grossProfit, marginPct, charges, taxDetails };
  }
}
