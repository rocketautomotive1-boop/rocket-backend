import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { MarketplaceCredentialsService } from '../marketplace/credentials/marketplace-credentials.service';

export interface MercadoPagoCardPaymentInput {
  amount: number;
  token: string; // card token gerado no frontend (Payment Brick), nunca dado bruto de cartão
  installments: number;
  paymentMethodId: string; // ex. 'visa', 'master'
  issuerId?: string;
  payer: { email: string; document?: string };
  description: string;
  externalReference: string;
}

export interface MercadoPagoPixPaymentInput {
  amount: number;
  payer: { email: string; document?: string; name?: string };
  description: string;
  externalReference: string;
}

export interface MercadoPagoBoletoPaymentInput {
  amount: number;
  payer: { email: string; document: string; name: string };
  description: string;
  externalReference: string;
}

export interface MercadoPagoPaymentResult {
  id: number;
  status: 'approved' | 'pending' | 'in_process' | 'rejected' | string;
  statusDetail: string;
  qrCode?: string; // Pix copia-e-cola
  qrCodeBase64?: string; // Pix QR code (imagem base64)
  ticketUrl?: string; // Boleto (link de impressão)
}

/**
 * Checkout Transparente (Payments API) do Mercado Pago — cria pagamentos de
 * cartão (tokenizado via Payment Brick no frontend), Pix e boleto. Distinto do
 * MercadoPagoClient (só leitura de saldo/reports) — este serviço EXECUTA cobranças.
 *
 * Reusa a mesma credencial (tag 'mercadopago', chave 'mpAccessToken') e o mesmo
 * fallback de env (MP_MERCADOPAGO_MPACCESSTOKEN) do cliente de saldo, pois é a
 * mesma conta MP dona da loja.
 */
@Injectable()
export class MercadoPagoCheckoutService {
  private readonly logger = new Logger(MercadoPagoCheckoutService.name);
  private readonly http: AxiosInstance = axios.create({
    baseURL: 'https://api.mercadopago.com',
    timeout: 30_000,
  });

  private readonly credentialTag = 'mercadopago';
  private readonly tokenKey = 'mpAccessToken';

  constructor(private readonly credentials: MarketplaceCredentialsService) {}

  private async authHeader(idempotencyKey?: string): Promise<Record<string, string>> {
    const token = await this.credentials.get(this.credentialTag, this.tokenKey);
    if (!token) {
      throw new UnauthorizedException(
        `Token do Mercado Pago não configurado. Defina a credencial '${this.tokenKey}' ` +
          `(POST /marketplace-auth/:id/credentials) ou MP_MERCADOPAGO_MPACCESSTOKEN no .env.`,
      );
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  async createCardPayment(input: MercadoPagoCardPaymentInput): Promise<MercadoPagoPaymentResult> {
    const headers = await this.authHeader(`card-${input.externalReference}`);
    try {
      const { data } = await this.http.post(
        '/v1/payments',
        {
          transaction_amount: input.amount,
          token: input.token,
          description: input.description,
          installments: input.installments,
          payment_method_id: input.paymentMethodId,
          issuer_id: input.issuerId,
          external_reference: input.externalReference,
          payer: { email: input.payer.email, identification: this.identification(input.payer.document) },
        },
        { headers },
      );
      return this.mapResult(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async createPixPayment(input: MercadoPagoPixPaymentInput): Promise<MercadoPagoPaymentResult> {
    const headers = await this.authHeader(`pix-${input.externalReference}`);
    try {
      const { data } = await this.http.post(
        '/v1/payments',
        {
          transaction_amount: input.amount,
          description: input.description,
          payment_method_id: 'pix',
          external_reference: input.externalReference,
          payer: {
            email: input.payer.email,
            first_name: input.payer.name,
            identification: this.identification(input.payer.document),
          },
        },
        { headers },
      );
      const result = this.mapResult(data);
      const pixData = data.point_of_interaction?.transaction_data;
      result.qrCode = pixData?.qr_code;
      result.qrCodeBase64 = pixData?.qr_code_base64;
      return result;
    } catch (error) {
      this.handleError(error);
    }
  }

  async createBoletoPayment(input: MercadoPagoBoletoPaymentInput): Promise<MercadoPagoPaymentResult> {
    const headers = await this.authHeader(`boleto-${input.externalReference}`);
    try {
      const { data } = await this.http.post(
        '/v1/payments',
        {
          transaction_amount: input.amount,
          description: input.description,
          payment_method_id: 'bolbradesco',
          external_reference: input.externalReference,
          payer: {
            email: input.payer.email,
            first_name: input.payer.name,
            identification: this.identification(input.payer.document),
          },
        },
        { headers },
      );
      const result = this.mapResult(data);
      result.ticketUrl = data.transaction_details?.external_resource_url;
      return result;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getPayment(paymentId: string | number): Promise<MercadoPagoPaymentResult> {
    const headers = await this.authHeader();
    const { data } = await this.http.get(`/v1/payments/${paymentId}`, { headers });
    return this.mapResult(data);
  }

  /** Verifica assinatura HMAC do webhook de pagamentos (x-signature/x-request-id). */
  async verifyWebhookSignature(
    signatureHeader: string | undefined,
    requestId: string | undefined,
    dataId: string,
  ): Promise<boolean> {
    const secret = await this.credentials.get(this.credentialTag, 'mpWebhookSecret');
    if (!secret) {
      this.logger.warn('mpWebhookSecret não configurado — pulando verificação de assinatura do webhook MP.');
      return true;
    }
    if (!signatureHeader) return false;

    const parts = Object.fromEntries(
      signatureHeader.split(',').map(p => p.trim().split('=').map(s => s.trim())) as [string, string][],
    );
    const ts = parts['ts'];
    const hash = parts['v1'];
    if (!ts || !hash) return false;

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return computed === hash;
  }

  private identification(document?: string): { type: string; number: string } | undefined {
    if (!document) return undefined;
    const digits = document.replace(/\D/g, '');
    return { type: digits.length > 11 ? 'CNPJ' : 'CPF', number: digits };
  }

  private mapResult(data: any): MercadoPagoPaymentResult {
    return {
      id: data.id,
      status: data.status,
      statusDetail: data.status_detail,
    };
  }

  private handleError(error: any): never {
    const mpMessage = error?.response?.data?.message || error?.response?.data?.cause?.[0]?.description;
    this.logger.error(`Erro Mercado Pago: ${mpMessage || error.message}`);
    throw new BadRequestException(mpMessage || 'Falha ao processar pagamento no Mercado Pago');
  }
}
