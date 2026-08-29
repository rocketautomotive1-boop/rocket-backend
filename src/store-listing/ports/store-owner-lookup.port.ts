export const STORE_OWNER_LOOKUP_PORT = Symbol('STORE_OWNER_LOOKUP_PORT');

/**
 * Port folha: resolve só a loja dona de um produto (via StoreListing), sem o restante do
 * domínio store-listing (warehouses/boxes/allocations/marketplace listings). Existe para que
 * consumidores que só precisam dessa identidade (StockLedgerProvider, StoreListingStockQueryService)
 * não precisem depender de STORE_LISTING_PORT inteiro — isso é o que causava um ciclo real de
 * instanciação quando STOCK_QUERY_PORT passou a apontar para um provider que também dependia de
 * STORE_LISTING_PORT (StoreListingService, que por sua vez injeta STOCK_QUERY_PORT para
 * getAllocationProducts). Ver docs/superpowers/specs/2026-08-29-stock-store-listing-di-cycle-fix-design.md.
 */
export interface StoreOwnerLookupPort {
  /**
   * Loja dona do produto, se houver. Determinístico em caso de múltiplas StoreListing para o
   * mesmo produto (não deveria acontecer hoje — um produto tem no máximo uma): a mais antiga.
   */
  findStoreIdByProduct(productId: string): Promise<string | null>;
}
