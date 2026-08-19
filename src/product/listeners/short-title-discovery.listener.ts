import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ShortTitleDiscoveryService } from '../services/short-title-discovery.service';
import { ListingService } from '../../listing/listing.service';
import { PRODUCT_SECTION_EVENTS, ProductTitlesSavedEvent } from '../events/product-section-saved.event';

/**
 * Reage a TITLES_SAVED tentando resolver Product.titleId a partir de algum
 * título de marketplace já salvo — reativa a cadeia titleId → category hint
 * (useCategoryFlow.ts) que hoje nunca dispara porque nada preenche titleId.
 * Ver docs/superpowers/specs/2026-08-19-shorttitle-discovery-from-titles-design.md.
 */
@Injectable()
export class ShortTitleDiscoveryListener {
    private readonly logger = new Logger(ShortTitleDiscoveryListener.name);

    constructor(
        private readonly discoveryService: ShortTitleDiscoveryService,
        private readonly listingService: ListingService,
    ) { }

    @OnEvent(PRODUCT_SECTION_EVENTS.TITLES_SAVED)
    onTitlesSaved(event: ProductTitlesSavedEvent): void {
        void this.resolve(event.productId);
    }

    private async resolve(productId: string): Promise<void> {
        try {
            const listings = await this.listingService.findByProduct(productId);
            const firstTitle = listings.find((l) => l.title?.trim())?.title;
            if (!firstTitle) return;

            await this.discoveryService.resolveForProduct(productId, firstTitle);
        } catch (err) {
            this.logger.error(`ShortTitle discovery falhou (productId=${productId}): ${(err as Error).message}`);
        }
    }
}
