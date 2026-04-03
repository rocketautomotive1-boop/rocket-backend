import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from '../../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const truncate = (s: string, max = 40) =>
  s.length > max ? s.slice(0, max - 1) + '…' : s;

const STATUS_LABEL: Record<string, string> = {
  approved:    '✅',
  pending:     '⏳',
  in_process:  '🔄',
  rejected:    '❌',
  refunded:    '↩️',
  cancelled:   '🚫',
  charged_back:'⚠️',
};

@Injectable()
export class MovementsMlQuery {
  private readonly logger = new Logger(MovementsMlQuery.name);
  private readonly mpBaseUrl = 'https://api.mercadopago.com';

  constructor(private readonly mlAuth: MercadoLivreAuthAdapter) {}

  async execute(): Promise<string> {
    try {
      const token = await this.mlAuth.getValidToken('Mercado Livre');

      // Janela: hoje 00:00 até agora (BRT = UTC-3)
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
          end_date:   fmtDate(now),
          sort:       'date_created',
          criteria:   'desc',
          limit:      50,
        },
      });

      const payments: any[] = data.results ?? [];

      if (!payments.length) {
        return `💳 Nenhuma movimentação no Mercado Pago hoje.`;
      }

      // Agrupa por status
      const approved  = payments.filter(p => p.status === 'approved');
      const pending   = payments.filter(p => ['pending', 'in_process'].includes(p.status));
      const problems  = payments.filter(p => ['rejected', 'refunded', 'cancelled', 'charged_back'].includes(p.status));

      const totalGross = approved.reduce((s, p) => s + (p.transaction_amount ?? 0), 0);
      const totalNet   = approved.reduce((s, p) => s + (p.transaction_details?.net_received_amount ?? 0), 0);
      const totalFees  = totalGross - totalNet;

      const lines: string[] = [
        `💳 *Movimentações Mercado Pago — Hoje*`,
        ``,
        `📊 *Resumo*`,
        `  ${approved.length} aprovados · ${fmt(totalGross)} bruto`,
        ...(totalFees > 0 ? [`  Taxas/comissões: -${fmt(totalFees)}`] : []),
        `  Líquido recebido: ${fmt(totalNet)}`,
        ...(pending.length  ? [`  ${pending.length} pendente(s)`]   : []),
        ...(problems.length ? [`  ${problems.length} com problema(s)`] : []),
        ``,
        `📋 *Detalhes*`,
      ];

      for (const p of payments) {
        const icon  = STATUS_LABEL[p.status] ?? '•';
        const time  = new Date(p.date_approved ?? p.date_created)
          .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const gross = fmt(p.transaction_amount ?? 0);
        const net   = p.transaction_details?.net_received_amount != null
          ? ` → ${fmt(p.transaction_details.net_received_amount)}`
          : '';
        const desc  = truncate(p.description ?? `Pagamento #${p.id}`);
        lines.push(`  ${icon} ${time} · ${gross}${net} · ${desc}`);
      }

      if ((data.paging?.total ?? 0) > 50) {
        lines.push(``, `_Mostrando os 50 mais recentes de ${data.paging.total} total._`);
      }

      return lines.join('\n');
    } catch (err) {
      this.logger.error(`MovementsMlQuery failed: ${err.message}`);
      return `❌ Erro ao buscar movimentações: ${err.message}`;
    }
  }
}
