import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from '../../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

@Injectable()
export class BalanceMlQuery {
  private readonly logger = new Logger(BalanceMlQuery.name);
  private readonly mpBaseUrl = 'https://api.mercadopago.com';
  private readonly mlBaseUrl = 'https://api.mercadolibre.com';
  private readonly ML_NAME = 'Mercado Livre';

  constructor(private readonly mlAuth: MercadoLivreAuthAdapter) {}

  async execute(): Promise<string> {
    try {
      const token = await this.mlAuth.getValidToken(this.ML_NAME);
      const headers = { Authorization: `Bearer ${token}` };
      const userId = await this.resolveUserId(token);

      const { data: balance } = await axios.get(
        `${this.mpBaseUrl}/users/${userId}/mercadopago_account/balance`,
        { headers },
      );

      const available   = Number(balance.available_balance   ?? 0);
      const unavailable = Number(balance.unavailable_balance ?? 0);
      const total       = Number(balance.total_amount        ?? available + unavailable);

      return [
        `💰 *Saldo Mercado Pago*`,
        `✅ Disponível: ${fmt(available)}`,
        `⏳ A liberar: ${fmt(unavailable)}`,
        `💵 Total: ${fmt(total)}`,
      ].join('\n');
    } catch (err) {
      const message = this.toReadableMessage(err);
      this.logger.error(`BalanceMlQuery failed: ${message}`);
      return `❌ Não foi possível buscar o saldo do Mercado Livre: ${message}`;
    }
  }

  private async resolveUserId(token: string): Promise<string> {
    try {
      const { data } = await axios.get(`${this.mlBaseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (data?.id) return String(data.id);
    } catch (err) {
      this.logger.warn(`Failed to resolve userId via /users/me: ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.mlAuth.getUserId(this.ML_NAME);
  }

  private toReadableMessage(err: unknown): string {
    if (!axios.isAxiosError(err)) return err instanceof Error ? err.message : String(err);

    const status = err.response?.status;
    if (status === 403) {
      return 'acesso negado pelo Mercado Pago (403). Reautorize a conta do Mercado Livre/MP no painel.';
    }

    const apiMessage =
      (typeof err.response?.data === 'object' && err.response?.data && 'message' in err.response.data)
        ? String((err.response.data as { message?: unknown }).message)
        : null;

    return apiMessage || err.message;
  }
}
