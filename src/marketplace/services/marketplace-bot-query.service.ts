import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from '../adapters/mercado-livre/mercado-livre-auth.adapter';
import { BalanceQueryPort } from '../../notifications/bot/ports/bot-query.ports';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const truncate = (s: string, max = 40) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

const STATUS_LABEL: Record<string, string> = {
  approved: '✅', pending: '⏳', in_process: '🔄', rejected: '❌',
  refunded: '↩️', cancelled: '🚫', charged_back: '⚠️',
};

/**
 * Implementação do BALANCE_QUERY_PORT (bot WhatsApp). Saldo/movimentações Mercado Pago.
 *
 * Autenticação canônica: token e userId resolvidos via MercadoLivreAuthAdapter
 * (TokenManager → broker → DB), sem token-por-arg nem /users/me cru. axios é usado
 * apenas para os endpoints do Mercado Pago (api.mercadopago.com), fora da família ML.
 */
@Injectable()
export class MarketplaceBotQueryService implements BalanceQueryPort {
  private readonly logger = new Logger(MarketplaceBotQueryService.name);
  private readonly mpBaseUrl = 'https://api.mercadopago.com';
  private readonly ML_NAME = 'Mercado Livre';

  constructor(private readonly mlAuth: MercadoLivreAuthAdapter) {}

  async getMlBalance(): Promise<string> {
    try {
      const token = await this.mlAuth.getValidToken(this.ML_NAME);
      const userId = await this.mlAuth.getUserId(this.ML_NAME);
      const headers = { Authorization: `Bearer ${token}` };

      const { data: balance } = await axios.get(
        `${this.mpBaseUrl}/users/${userId}/mercadopago_account/balance`,
        { headers },
      );

      const available = Number(balance.available_balance ?? 0);
      const unavailable = Number(balance.unavailable_balance ?? 0);
      const total = Number(balance.total_amount ?? available + unavailable);

      return [
        `💰 *Saldo Mercado Pago*`,
        `✅ Disponível: ${fmt(available)}`,
        `⏳ A liberar: ${fmt(unavailable)}`,
        `💵 Total: ${fmt(total)}`,
      ].join('\n');
    } catch (err) {
      const message = this.toReadableMessage(err);
      this.logger.error(`getMlBalance failed: ${message}`);
      return `❌ Não foi possível buscar o saldo do Mercado Livre: ${message}`;
    }
  }

  async getMlMovements(): Promise<string> {
    try {
      const token = await this.mlAuth.getValidToken(this.ML_NAME);

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const pad = (n: number) => String(n).padStart(2, '0');
      const fmtDate = (d: Date) => {
        const offset = -3 * 60;
        const local = new Date(d.getTime() + offset * 60_000);
        return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.000-03:00`;
      };

      const { data } = await axios.get(`${this.mpBaseUrl}/v1/payments/search`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          begin_date: fmtDate(todayStart),
          end_date: fmtDate(now),
          sort: 'date_created',
          criteria: 'desc',
          limit: 50,
        },
      });

      const payments: any[] = data.results ?? [];
      if (!payments.length) {
        return `💳 Nenhuma movimentação no Mercado Pago hoje.`;
      }

      const approved = payments.filter(p => p.status === 'approved');
      const pending = payments.filter(p => ['pending', 'in_process'].includes(p.status));
      const problems = payments.filter(p => ['rejected', 'refunded', 'cancelled', 'charged_back'].includes(p.status));

      const totalGross = approved.reduce((s, p) => s + (p.transaction_amount ?? 0), 0);
      const totalNet = approved.reduce((s, p) => s + (p.transaction_details?.net_received_amount ?? 0), 0);
      const totalFees = totalGross - totalNet;

      const lines: string[] = [
        `💳 *Movimentações Mercado Pago — Hoje*`,
        ``,
        `📊 *Resumo*`,
        `  ${approved.length} aprovados · ${fmt(totalGross)} bruto`,
        ...(totalFees > 0 ? [`  Taxas/comissões: -${fmt(totalFees)}`] : []),
        `  Líquido recebido: ${fmt(totalNet)}`,
        ...(pending.length ? [`  ${pending.length} pendente(s)`] : []),
        ...(problems.length ? [`  ${problems.length} com problema(s)`] : []),
        ``,
        `📋 *Detalhes*`,
      ];

      for (const p of payments) {
        const icon = STATUS_LABEL[p.status] ?? '•';
        const time = new Date(p.date_approved ?? p.date_created)
          .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const gross = fmt(p.transaction_amount ?? 0);
        const net = p.transaction_details?.net_received_amount != null
          ? ` → ${fmt(p.transaction_details.net_received_amount)}`
          : '';
        const desc = truncate(p.description ?? `Pagamento #${p.id}`);
        lines.push(`  ${icon} ${time} · ${gross}${net} · ${desc}`);
      }

      if ((data.paging?.total ?? 0) > 50) {
        lines.push(``, `_Mostrando os 50 mais recentes de ${data.paging.total} total._`);
      }

      return lines.join('\n');
    } catch (err) {
      this.logger.error(`getMlMovements failed: ${err.message}`);
      return `❌ Erro ao buscar movimentações: ${err.message}`;
    }
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
