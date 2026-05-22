// backend/src/product/services/product-readiness.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductRepository } from '../product.repository';
import { ProductTitleService } from './product-title.service';
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

@Injectable()
export class ProductReadinessService {
  private readonly logger = new Logger(ProductReadinessService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly productTitleService: ProductTitleService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(PRODUCT_SECTION_EVENTS.DIMENSIONS_SAVED)
  async onDimensionsSaved(event: ProductDimensionsSavedEvent) {
    await this.recalculate(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.IMAGES_SAVED)
  async onImagesSaved(event: ProductImagesSavedEvent) {
    await this.recalculate(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.TITLES_SAVED)
  async onTitlesSaved(event: ProductTitlesSavedEvent) {
    await this.recalculate(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED)
  async onCategorySaved(event: ProductCategorySavedEvent) {
    await this.recalculate(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.INVENTORY_SAVED)
  async onInventorySaved(event: ProductInventorySavedEvent) {
    await this.recalculate(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.DATA_SAVED)
  async onDataSaved(event: ProductDataSavedEvent) {
    await this.recalculate(event.productId);
  }

  private parseNum(v: unknown): number {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async recalculate(productId: string): Promise<void> {
    try {
      const product = await this.productRepository.findByIdClean(productId);
      if (!product) return;

      const brandObj = (product as any).brand || (product as any).brands;
      const hasBrand = !!brandObj?.name || !!brandObj?.shortName;
      const data = !!((product as any).partNumber && hasBrand);

      const images = Array.isArray((product as any).images) && (product as any).images.length > 0;

      const titles = await this.productTitleService.findByProductId(productId);
      const titlesOk = Array.isArray(titles) && titles.length > 0;

      const category = !!(product as any).category;

      const stockQty = await this.productRepository.calculateStock(productId);
      const priceRaw = (product as any).price ? Number((product as any).price) : 0;
      const inventory = stockQty > 0 && priceRaw > 0;

      const w = this.parseNum((product as any).weight);
      const dim = (product as any).dimensions || {};
      const dimensions = w > 0 && this.parseNum(dim.length) > 0 && this.parseNum(dim.width) > 0 && this.parseNum(dim.height) > 0;

      const readyToPublish = data && images && titlesOk && category && inventory && dimensions;

      const previousReady = !!(product as any).completion?.readyToPublish;
      const alreadyCompletedAt = (product as any).completion?.completedAt ?? null;

      let completedAt: Date | null;
      if (readyToPublish) {
        completedAt = alreadyCompletedAt ?? new Date();
      } else {
        completedAt = null;
      }

      await this.productRepository.update(productId, {
        $set: {
          readyToPublish,
          completion: { data, images, titles: titlesOk, category, inventory, dimensions, readyToPublish, completedAt },
        },
      });

      if (readyToPublish && !previousReady) {
        this.logger.log(`Product ${productId} became ready — emitting ProductBecameReadyEvent`);
        this.eventEmitter.emit(
          PRODUCT_SECTION_EVENTS.BECAME_READY,
          new ProductBecameReadyEvent(productId, completedAt!),
        );
      }
    } catch (err) {
      this.logger.error(`Failed to recalculate readiness for product ${productId}: ${(err as Error).message}`);
    }
  }
}
