import { Injectable } from '@nestjs/common';

export type CommandIntent =
  | 'BALANCE_ML'
  | 'BALANCE_SHOPEE'
  | 'BALANCE_ALL'
  | 'SALES_TODAY'
  | 'SALES_WEEK'
  | 'ORDERS_PENDING'
  | 'MOVEMENTS_ML'
  | 'SEARCH_PRODUCT'
  | 'HELP'
  | 'UNKNOWN';

@Injectable()
export class WhatsAppCommandRouter {
  route(body: string): CommandIntent {
    const t = this.normalize(body);

    if (t.includes('saldo')) {
      if (t.includes('ml') || t.includes('mercado livre') || t.includes('mercadolivre')) return 'BALANCE_ML';
      if (t.includes('shopee')) return 'BALANCE_SHOPEE';
      return 'BALANCE_ALL';
    }
    if (t.includes('movimentac') || t.includes('movimentacao') || t.includes('extrato')) {
      return 'MOVEMENTS_ML';
    }
    if (t.includes('vendas')) {
      return t.includes('semana') ? 'SALES_WEEK' : 'SALES_TODAY';
    }
    if (t.includes('pedidos') && (t.includes('pendente') || t.includes('envio') || t.includes('aguardando'))) {
      return 'ORDERS_PENDING';
    }
    if (t.includes('buscar produto')) return 'SEARCH_PRODUCT';
    if (t.includes('ajuda') || t.includes('help') || t.includes('comandos')) return 'HELP';
    return 'UNKNOWN';
  }

  extractSearchTerm(body: string): string | null {
    const normalized = this.normalize(body);
    const match = normalized.match(/\bbuscar produto\b(.*)$/);
    if (!match) return null;

    const term = match[1].trim();
    return term.length ? term : null;
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
}
