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
/** Como a loja de uma venda foi resolvida. `ambiguous`/`none` ⇒ storeId null (chamador NÃO deve adivinhar). */
export interface StoreResolution {
  storeId: string | null;
  via: 'listing' | 'single' | 'ambiguous' | 'none';
}

export interface SaleStoreQuery {
  productId: string;
  /** Marketplace + id do anúncio vendido (item do pedido). Sem eles só resolve produto de loja única. */
  marketplaceId?: string;
  listingExternalId?: string;
}

export interface StoreOwnerLookupPort {
  /**
   * Loja que deve receber a movimentação de uma VENDA: a loja do Listing vendido (um externalId
   * do marketplace pertence a exatamente uma conta ⇒ uma loja). Sem anúncio resolvido, só um
   * produto com UMA StoreListing é inequívoco; com várias devolve `ambiguous` — nunca escolhe
   * "a mais antiga" (era o que mandava a baixa do 7086768 para a loja sem estoque).
   */
  resolveStoreForSale(query: SaleStoreQuery): Promise<StoreResolution>;

  /**
   * Loja dona do produto, se houver. Só para LEITURA/legado: com múltiplas StoreListing devolve a
   * mais antiga (arbitrário). Movimentação de venda deve usar resolveStoreForSale.
   */
  findStoreIdByProduct(productId: string): Promise<string | null>;
}
