import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from '../../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

@Injectable()
export class BalanceMlQuery {
  private readonly logger = new Logger(BalanceMlQuery.name);
  private readonly mpBaseUrl = 'https://api.mercadopago.com';
  private readonly ML_NAME = 'Mercado Livre';

  constructor(private readonly mlAuth: MercadoLivreAuthAdapter) {}

  async execute(): Promise<string> {
    try {
      const token = await this.mlAuth.getValidToken(this.ML_NAME);
      const headers = { Authorization: `Bearer ${token}` };

      const userId = await this.mlAuth.getUserId(this.ML_NAME);

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
      this.logger.error(`BalanceMlQuery failed: ${err.message}`);
      return `❌ Não foi possível buscar o saldo do Mercado Livre: ${err.message}`;
    }
  }
}
