import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { MarketplaceCredentialsService } from '../marketplace/credentials/marketplace-credentials.service';

/**
 * Cliente HTTP do Mercado Pago (api.mercadopago.com).
 *
 * IMPORTANTE: o token do MP é DIFERENTE do token do Mercado Livre. O token ML
 * (app de marketplace) recebe 403 no saldo/relatórios. Aqui usamos o Access Token
 * NATIVO do Mercado Pago (app de pagamentos, estático/permanente), lido como
 * credencial `mpAccessToken` da tag do Mercado Livre (mesma conta dona).
 *
 * Resolução do token: DB criptografado (marketplaces.credentials.mpAccessToken
 * sob a tag 'mercadopago') → fallback env (MP_MERCADOPAGO_MPACCESSTOKEN). Sem
 * TokenManager/refresh — o token MP não tem fluxo OAuth de renovação.
 */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: 'https://api.mercadopago.com',
    timeout: 30_000,
  });

  /** Tag do marketplace dono da credencial do token MP. */
  private readonly credentialTag = 'mercadopago';
  private readonly tokenKey = 'mpAccessToken';

  constructor(private readonly credentials: MarketplaceCredentialsService) {}

  private async authHeader(): Promise<{ Authorization: string }> {
    const token = await this.credentials.get(this.credentialTag, this.tokenKey);
    if (!token) {
      throw new UnauthorizedException(
        `Token do Mercado Pago não configurado. Defina a credencial '${this.tokenKey}' ` +
          `(POST /marketplace-auth/:id/credentials) ou MP_MERCADOPAGO_MPACCESSTOKEN no .env.`,
      );
    }
    return { Authorization: `Bearer ${token}` };
  }

  /** userId/accountId do MP dono do token (GET /users/me). */
  async getAccountId(): Promise<string> {
    const headers = await this.authHeader();
    const { data } = await this.http.get('/users/me', { headers });
    return String(data.id);
  }

  // ── Release report (fonte do saldo DISPONÍVEL) ────────────────────────────

  /** Dispara a geração on-demand de um release_report para o intervalo. → 202 */
  async generateReleaseReport(beginDate: Date, endDate: Date): Promise<void> {
    const headers = await this.authHeader();
    await this.http.post(
      '/v1/account/release_report',
      { begin_date: this.toMpDate(beginDate), end_date: this.toMpDate(endDate) },
      { headers },
    );
  }

  /**
   * Formato de data aceito pelo release_report: `YYYY-MM-DDTHH:mm:ssZ` (UTC, SEM
   * milissegundos). O `Date.toISOString()` inclui `.SSS` e o MP rejeita com
   * `invalid_begin_date`. Cortamos os milissegundos.
   */
  private toMpDate(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /** Lista os reports gerados (já prontos). file_name é usado para download. */
  async listReleaseReports(): Promise<ReleaseReportListItem[]> {
    const headers = await this.authHeader();
    const { data } = await this.http.get<ReleaseReportListItem[]>(
      '/v1/account/release_report/list',
      { headers },
    );
    return data ?? [];
  }

  /** Baixa o CSV de um report pronto (separador `;`). */
  async downloadReleaseReport(fileName: string): Promise<string> {
    const headers = await this.authHeader();
    const { data } = await this.http.get<string>(
      `/v1/account/release_report/${fileName}`,
      { headers, responseType: 'text' },
    );
    return data;
  }

  // ── Payments (fonte do saldo A LIBERAR) ───────────────────────────────────

  /** Página de pagamentos aprovados (mais recentes primeiro). */
  async searchApprovedPayments(offset: number, limit = 50): Promise<PaymentsSearchPage> {
    const headers = await this.authHeader();
    const { data } = await this.http.get<PaymentsSearchPage>('/v1/payments/search', {
      headers,
      params: {
        status: 'approved',
        sort: 'date_created',
        criteria: 'desc',
        limit,
        offset,
      },
    });
    return data;
  }
}

export interface ReleaseReportListItem {
  id: number;
  file_name: string;
  status: string;
  date_created: string;
  begin_date: string;
  end_date: string;
}

export interface PaymentResult {
  id: number;
  money_release_status?: 'released' | 'pending' | string;
  money_release_date?: string;
  transaction_amount?: number;
  transaction_details?: { net_received_amount?: number };
}

export interface PaymentsSearchPage {
  results: PaymentResult[];
  paging: { total: number; limit: number; offset: number };
}
