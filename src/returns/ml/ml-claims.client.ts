import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

const ML_BASE_URL = 'https://api.mercadolibre.com';

export interface MlClaimSummary {
  id: string;
  type: string | null;            // mediations | cancellations | returns | fulfillment
  stage: string | null;           // claim | dispute | recontact | none
  status: string | null;          // opened | closed | ...
  reasonId: string | null;
  orderId: string | null;
  buyerName: string | null;
  firstItemTitle: string | null;
  firstQty: number | null;
  extraItemsCount: number;
  totalAmount: number | null;
  soldAt: string | null;
}

/**
 * Thin read client for ML's post-purchase claims (devoluções/reclamações). Mirrors
 * MlModerationsClient: token is passed in by the caller (resolved live via the broker,
 * never cached — CLAUDE.md). Enriches the claim with order data (1st item title, buyer,
 * amount) best-effort so the notification carries context.
 */
@Injectable()
export class MlClaimsClient {
  private readonly logger = new Logger(MlClaimsClient.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: ML_BASE_URL, timeout: 10_000 });
  }

  async getClaimSummary(claimId: string, accessToken: string): Promise<MlClaimSummary | null> {
    let claim: any;
    try {
      const res = await this.http.get(`/post-purchase/v1/claims/${claimId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      claim = res.data;
    } catch (err) {
      this.logger.warn(`getClaimSummary(${claimId}) falhou: ${(err as Error).message}`);
      return null;
    }
    if (!claim) return null;

    // O claim referencia o pedido em resource_id quando resource === 'order'.
    const orderId =
      claim.resource === 'order' && claim.resource_id ? String(claim.resource_id) : null;
    const order = orderId ? await this.getOrder(orderId, accessToken) : null;

    const items: any[] = order?.order_items ?? [];
    const firstItem = items[0];
    const buyer = order?.buyer ?? {};
    const buyerName =
      (buyer.first_name || buyer.last_name)
        ? `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim()
        : buyer.nickname || null;

    return {
      id: String(claim.id ?? claimId),
      type: claim.type ?? null,
      stage: claim.stage ?? null,
      status: claim.status ?? null,
      reasonId: claim.reason_id ?? null,
      orderId,
      buyerName,
      firstItemTitle: firstItem?.item?.title ?? null,
      firstQty: firstItem?.quantity ?? null,
      extraItemsCount: items.length ? Math.max(0, items.length - 1) : 0,
      totalAmount: order?.total_amount ?? null,
      soldAt: order?.date_created ?? null,
    };
  }

  private async getOrder(orderId: string, accessToken: string): Promise<any | null> {
    try {
      const res = await this.http.get(`/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.data ?? null;
    } catch (err) {
      this.logger.warn(`[Claim] enrich do pedido ${orderId} falhou: ${(err as Error).message}`);
      return null;
    }
  }
}
