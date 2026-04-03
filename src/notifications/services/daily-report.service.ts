import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderModel } from '../../order/schemas/order.schema';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { ConfigService } from '@nestjs/config';

const PAID_STATUSES = ['paid', 'shipped', 'delivered', 'ready_to_ship', 'payment_done'];

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

@Injectable()
export class DailyReportService {
  private readonly logger = new Logger(DailyReportService.name);
  private readonly groupId: string;

  constructor(
    @InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>,
    private readonly baileys: BaileysWhatsAppProvider,
    private readonly configService: ConfigService,
  ) {
    this.groupId = this.configService.get('WHATSAPP_GROUP_ID', '');
  }

  // Toda meia-noite no horário do servidor (BRT)
  @Cron('0 0 0 * * *')
  async handleDailyReport(): Promise<void> {
    this.logger.log('Generating daily sales report...');
    try {
      const message = await this.buildReport();
      if (!message) {
        this.logger.log('No sales today — skipping daily report');
        return;
      }
      await this.baileys.sendMessage(this.groupId, message);
      this.logger.log('Daily report sent');
    } catch (err) {
      this.logger.error(`Daily report failed: ${err.message}`);
    }
  }

  private async buildReport(): Promise<string | null> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    todayStart.setDate(todayStart.getDate() - 1); // dia anterior (relatório do dia que fechou)
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const [todayRows, yesterdayRows] = await Promise.all([
      this.aggregate(todayStart, todayEnd),
      this.aggregate(yesterdayStart, yesterdayEnd),
    ]);

    if (!todayRows.length) return null;

    const T = this.totals(todayRows);
    const Y = this.totals(yesterdayRows);

    const dateLabel = todayStart.toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: '2-digit',
    });

    // Variação dia anterior
    const varGross  = Y.gross  > 0 ? ((T.gross  - Y.gross)  / Y.gross  * 100) : null;
    const varCount  = Y.count  > 0 ? ((T.count  - Y.count)  / Y.count  * 100) : null;
    const varProfit = Y.profit > 0 ? ((T.profit - Y.profit) / Y.profit * 100) : null;

    const varLine = (label: string, v: number | null) =>
      v !== null ? ` (${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}% vs ontem)` : '';

    // Top 3 produtos por receita bruta
    const topProducts = await this.topProducts(todayStart, todayEnd);

    // Status breakdown (paid vs shipped vs delivered)
    const statusRows = await this.statusBreakdown(todayStart, todayEnd);

    const marginPct = T.gross > 0 ? (T.profit / T.gross * 100) : 0;

    const lines: string[] = [
      `📊 *Relatório de Vendas — ${dateLabel}*`,
      ``,
      `📦 *${T.count} pedidos*${varLine('pedidos', varCount)}`,
      ``,
      `💰 *Financeiro*`,
      `  Bruto:        ${fmt(T.gross)}${varLine('bruto', varGross)}`,
      ...(T.commission > 0 ? [`  Comissão ML:  -${fmt(T.commission)}`] : []),
      ...(T.freight    > 0 ? [`  Frete:        -${fmt(T.freight)}`]    : []),
      ...(T.taxes      > 0 ? [`  Impostos:     -${fmt(T.taxes)}`]      : []),
      ...(T.coupon     > 0 ? [`  Cupons:       -${fmt(T.coupon)}`]     : []),
      `  Líquido:      ${fmt(T.net)}`,
      ...(T.cost > 0  ? [`  CMV:          -${fmt(T.cost)}`]            : []),
      ...(T.profit !== 0 ? [
        `  Lucro:        ${fmt(T.profit)}${varLine('lucro', varProfit)} *(${pct(marginPct)})*`,
      ] : []),
    ];

    // Por marketplace
    if (todayRows.length > 1) {
      lines.push(``, `🏪 *Por marketplace*`);
      for (const r of todayRows) {
        const m = r.marginPct > 0 ? ` · margem ${pct(r.marginPct)}` : '';
        lines.push(`  ${r.name}: ${r.count} ped · ${fmt(r.gross)}${m}`);
      }
    }

    // Top produtos
    if (topProducts.length) {
      lines.push(``, `🔝 *Top produtos*`);
      topProducts.forEach((p, i) => {
        lines.push(`  ${i + 1}. ${p.title} — ${p.qty}x · ${fmt(p.revenue)}`);
      });
    }

    // Status dos pedidos
    if (statusRows.length > 1) {
      lines.push(``, `📋 *Status dos pedidos*`);
      const statusLabels: Record<string, string> = {
        paid: 'Pago', shipped: 'Enviado', delivered: 'Entregue',
        ready_to_ship: 'Pronto p/ envio', payment_done: 'Pagamento confirmado',
      };
      for (const s of statusRows) {
        lines.push(`  ${statusLabels[s.status] ?? s.status}: ${s.count}`);
      }
    }

    lines.push(``, `_Gerado automaticamente às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}_`);

    return lines.join('\n');
  }

  private async aggregate(from: Date, to: Date): Promise<any[]> {
    return this.orderModel.aggregate([
      {
        $match: {
          status: { $in: PAID_STATUSES },
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $lookup: {
          from: 'marketplaces',
          localField: 'marketplaceId',
          foreignField: '_id',
          as: 'mkt',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $arrayElemAt: ['$mkt.name', 0] }, 'Outro'] },
          count:      { $sum: 1 },
          gross:      { $sum: { $ifNull: ['$financialSnapshot.gross',      '$totalAmount'] } },
          commission: { $sum: { $ifNull: ['$financialSnapshot.commission', 0] } },
          freight:    { $sum: { $ifNull: ['$financialSnapshot.freight',    0] } },
          taxes:      { $sum: { $ifNull: ['$financialSnapshot.taxes',      0] } },
          coupon:     { $sum: { $ifNull: ['$financialSnapshot.coupon',     0] } },
          net:        { $sum: { $ifNull: ['$financialSnapshot.net',        '$totalAmount'] } },
          cost:       { $sum: { $ifNull: ['$financialSnapshot.costTotal',  0] } },
          profit:     { $sum: { $ifNull: ['$financialSnapshot.grossProfit', '$pricing.totals.totalNetProfit'] } },
        },
      },
      {
        $project: {
          name: '$_id',
          count: 1, gross: 1, commission: 1, freight: 1, taxes: 1,
          coupon: 1, net: 1, cost: 1, profit: 1,
          marginPct: {
            $cond: [
              { $gt: ['$gross', 0] },
              { $multiply: [{ $divide: ['$profit', '$gross'] }, 100] },
              0,
            ],
          },
          _id: 0,
        },
      },
      { $sort: { gross: -1 } },
    ]);
  }

  private totals(rows: any[]) {
    return rows.reduce(
      (a, r) => ({
        count:      a.count      + r.count,
        gross:      a.gross      + (r.gross      ?? 0),
        commission: a.commission + (r.commission ?? 0),
        freight:    a.freight    + (r.freight    ?? 0),
        taxes:      a.taxes      + (r.taxes      ?? 0),
        coupon:     a.coupon     + (r.coupon     ?? 0),
        net:        a.net        + (r.net        ?? 0),
        cost:       a.cost       + (r.cost       ?? 0),
        profit:     a.profit     + (r.profit     ?? 0),
      }),
      { count: 0, gross: 0, commission: 0, freight: 0, taxes: 0, coupon: 0, net: 0, cost: 0, profit: 0 },
    );
  }

  private async topProducts(from: Date, to: Date): Promise<{ title: string; qty: number; revenue: number }[]> {
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          status: { $in: PAID_STATUSES },
          createdAt: { $gte: from, $lte: to },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.title',
          qty:     { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 3 },
    ]);
    return rows.map(r => ({ title: r._id, qty: r.qty, revenue: r.revenue }));
  }

  private async statusBreakdown(from: Date, to: Date): Promise<{ status: string; count: number }[]> {
    return this.orderModel.aggregate([
      {
        $match: {
          status: { $in: PAID_STATUSES },
          createdAt: { $gte: from, $lte: to },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ]);
  }
}
