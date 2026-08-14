// backend/src/product/services/product-readiness.service.ts

import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductRepository } from '../product.repository';
import { STORE_LISTING_PORT, StoreListingPort } from '../../store-listing/ports/store-listing.port';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { ProductTitleService } from './product-title.service';
import { normalizeCompletedAt } from './product-readiness.normalize';
import { hasUsableImage } from '../completion/has-usable-image';
import {
  PRODUCT_SECTION_EVENTS,
  ProductDimensionsSavedEvent,
  ProductImagesSavedEvent,
  ProductTitlesSavedEvent,
  ProductCategorySavedEvent,
  ProductInventorySavedEvent,
  ProductDataSavedEvent,
  ProductBecameReadyEvent,
} from '../events/product-section-saved.event';

export interface ProductCompletionResult {
  data: boolean;
  images: boolean;
  titles: boolean;
  category: boolean;
  inventory: boolean;
  dimensions: boolean;
  readyToPublish: boolean;
}

@Injectable()
export class ProductReadinessService {
  private readonly logger = new Logger(ProductReadinessService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    @Inject(STORE_LISTING_PORT) private readonly storeListingPort: StoreListingPort,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    private readonly productTitleService: ProductTitleService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(PRODUCT_SECTION_EVENTS.DIMENSIONS_SAVED)
  async onDimensionsSaved(event: ProductDimensionsSavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.IMAGES_SAVED)
  async onImagesSaved(event: ProductImagesSavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.TITLES_SAVED)
  async onTitlesSaved(event: ProductTitlesSavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED)
  async onCategorySaved(event: ProductCategorySavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.INVENTORY_SAVED)
  async onInventorySaved(event: ProductInventorySavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.DATA_SAVED)
  async onDataSaved(event: ProductDataSavedEvent) {
    await this.refreshAndMaybeEmit(event.productId);
  }

  private parseNum(v: unknown): number {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Pure compute: derives the canonical completion state from product data.
   * No writes, no events. Always reflects current state — this is the
   * single source of truth.
   *
   * storeId: quando informado (usuário logado — GET /products/:id/completion), a leitura de
   * estoque é EXATAMENTE dessa loja, sem fallback para outra — um produto pode ter
   * StoreListings em múltiplas lojas (cada uma publica seu próprio anúncio), e "inventory"
   * precisa refletir o saldo da loja de quem está olhando, não de qualquer uma.
   * Quando ausente (gate de publish via internal-product.controller, listener assíncrono —
   * nenhum dos dois tem storeId de usuário disponível hoje), mantém o comportamento anterior
   * (primeira loja com StoreListing) até o publish multi-loja ser desenhado — ver
   * docs/superpowers/specs sobre a decomposição desse trabalho.
   */
  async compute(productId: string, storeId?: string): Promise<ProductCompletionResult | null> {
    const product = await this.productRepository.findByIdClean(productId);
    if (!product) return null;

    const brandObj = (product as any).brand || (product as any).brands;
    const hasBrand = !!brandObj?.name || !!brandObj?.shortName;
    const data = !!((product as any).partNumber && hasBrand);

    // Count only slots that resolved to a usable image. A reserved rembg slot that is
    // still 'processing' — or one whose background removal terminally 'failed' — must
    // NOT mark the Images section done (see completion/has-usable-image).
    const images = hasUsableImage((product as any).images);

    // Store-aware, igual ao estoque: com storeId (usuário logado), "titles done" só
    // pode significar "esta loja tem título", nunca "alguma loja tem título" — senão o
    // status aparece done mas a tela de Títulos (já isolada por loja) mostra vazio.
    // Sem storeId (gate de publish/listener assíncrono), mantém o comportamento anterior
    // (qualquer loja) até o publish multi-loja ser desenhado.
    const titles = storeId
      ? await this.productTitleService.findByProductIdAndStore(productId, storeId)
      : await this.productTitleService.findByProductId(productId);
    const titlesOk = Array.isArray(titles) && titles.length > 0;

    const category = !!(product as any).category;

    const resolvedStoreId = storeId ?? (await this.storeListingPort.findAnyByProduct(productId))?.storeId;
    const stockQty = resolvedStoreId
      ? (await this.storeListingPort.getStockSummary(productId, String(resolvedStoreId))).onHand
      : 0;
    // Sale price lives in PricingModule (removed from Product in the pricing refactor).
    const priceRaw = await this.pricing.getBasePrice(productId);
    const inventory = stockQty > 0 && priceRaw > 0;

    const w = this.parseNum((product as any).weight);
    const dim = (product as any).dimensions || {};
    const dimensions = w > 0
      && this.parseNum(dim.length) > 0
      && this.parseNum(dim.width) > 0
      && this.parseNum(dim.height) > 0;

    const readyToPublish = data && images && titlesOk && category && inventory && dimensions;

    return { data, images, titles: titlesOk, category, inventory, dimensions, readyToPublish };
  }

  /**
   * Recompute readiness and emit `BECAME_READY` on the false→true edge.
   *
   * IMPORTANT — the persisted `readyToPublish`/`completion.readyToPublish` is NOT a
   * source of truth. `compute()` is the single source; it is computed on every read
   * (frontend `/completion`, internal `/products/:id` publish gate). The persisted
   * value is ONLY a transition marker owned by this method: we compare the freshly
   * computed value against the previously-persisted one to fire `BECAME_READY` exactly
   * once. No other code may read it to decide readiness — doing so reintroduces the
   * drift bug (it goes stale whenever state changes via a path that emits no section
   * event, e.g. rembg finishing async, imports, scripts). Callers converge the marker
   * by ensuring every such async change emits a section-saved event that reaches here.
   */
  async refreshAndMaybeEmit(productId: string): Promise<void> {
    try {
      const computed = await this.compute(productId);
      if (!computed) return;

      const product = await this.productRepository.findByIdClean(productId);
      const previousReady = !!(product as any).completion?.readyToPublish;
      const previousCompletedAt = normalizeCompletedAt((product as any).completion?.completedAt);

      const completedAt = computed.readyToPublish
        ? (previousCompletedAt ?? new Date())
        : null;

      await this.productRepository.update(productId, {
        $set: {
          readyToPublish: computed.readyToPublish,
          'completion.readyToPublish': computed.readyToPublish,
          'completion.completedAt': completedAt,
        },
      });

      if (computed.readyToPublish && !previousReady) {
        this.logger.log(`Product ${productId} became ready — emitting ProductBecameReadyEvent`);
        this.eventEmitter.emit(
          PRODUCT_SECTION_EVENTS.BECAME_READY,
          new ProductBecameReadyEvent(productId, completedAt!),
        );
      }
    } catch (err) {
      this.logger.error(`Failed to refresh readiness for product ${productId}: ${(err as Error).message}`);
    }
  }

  /** Deprecated alias kept for backward compatibility with callers. */
  async recalculate(productId: string): Promise<void> {
    return this.refreshAndMaybeEmit(productId);
  }
}
