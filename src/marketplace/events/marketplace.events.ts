export class MarketplaceItemPublishedEvent {
  constructor(
    public readonly productId: string,
    /** id externo do item recém-criado ou atualizado (ex.: "MLB123456"). */
    public readonly externalId: string,
    /** nome do marketplace como registrado (ex.: 'Mercado Livre') — o mesmo usado em MarketplaceRegistryService.findByName. */
    public readonly marketplaceName: string,
    /** loja dona do anúncio, se conhecida — usada para resolver a conta correta. */
    public readonly storeId?: string,
  ) {}
}

export const MARKETPLACE_EVENTS = {
  /**
   * Emitido sempre que um adapter cria (POST) ou atualiza (PUT) um item com
   * sucesso e resolve um externalId — sinal genérico de "este produto agora
   * tem/continua tendo uma publicação viva neste marketplace". Consumidores
   * (ex.: sync de compatibilidades pendentes) decidem o que fazer com isso;
   * o adapter que emite não conhece nem depende dessa lógica.
   */
  ITEM_PUBLISHED: 'marketplace.item_published',
} as const;
