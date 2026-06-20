/**
 * Read-ports do bot WhatsApp. Declarados no broker (notifications); implementados
 * pelos módulos donos do dado (order/stock/marketplace). Inverte a dependência:
 * notifications NÃO importa OrderModule/StockModule/MarketplaceAuthModule.
 *
 * Cada método retorna um texto markdown pronto para enviar ao grupo.
 */

export const SALES_QUERY_PORT = Symbol('SALES_QUERY_PORT');
export interface SalesQueryPort {
  /** Relatório de vendas do período. */
  getSalesReport(period: 'today' | 'week'): Promise<string>;
  /** Pedidos pagos aguardando envio. */
  getPendingOrders(): Promise<string>;
}

export const BALANCE_QUERY_PORT = Symbol('BALANCE_QUERY_PORT');
export interface BalanceQueryPort {
  /** Saldo Mercado Pago/ML. */
  getMlBalance(): Promise<string>;
  /** Movimentações (extrato) do Mercado Pago hoje. */
  getMlMovements(): Promise<string>;
}

export const PRODUCT_INFO_QUERY_PORT = Symbol('PRODUCT_INFO_QUERY_PORT');
export interface ProductInfoQueryPort {
  /** Busca produto + estoque + preço + última movimentação. */
  searchProduct(term: string): Promise<string>;
}
