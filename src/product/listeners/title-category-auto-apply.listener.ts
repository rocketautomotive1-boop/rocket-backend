import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TitleCategoryHintService } from '../services/title-category-hint.service';
import { ProductRepository } from '../product.repository';
import { ProductService } from '../product.service';
import { PRODUCT_SECTION_EVENTS, ProductTitleIdResolvedEvent } from '../events/product-section-saved.event';

/**
 * Reage a TITLE_ID_RESOLVED aplicando a categoria sugerida (TitleCategoryHintService) direto no
 * produto, sem esperar nenhum frontend perguntar — fonte única no backend, admin e app mobile só
 * exibem o resultado já salvo. Nunca sobrescreve category já preenchida.
 */
@Injectable()
export class TitleCategoryAutoApplyListener {
    private readonly logger = new Logger(TitleCategoryAutoApplyListener.name);

    constructor(
        private readonly titleCategoryHintService: TitleCategoryHintService,
        private readonly productRepository: ProductRepository,
        private readonly productService: ProductService,
    ) { }

    @OnEvent(PRODUCT_SECTION_EVENTS.TITLE_ID_RESOLVED)
    async onTitleIdResolved(event: ProductTitleIdResolvedEvent): Promise<void> {
        try {
            const product = await this.productRepository.findByIdClean(event.productId);
            if (!product || (product as any).category) return; // nunca sobrescreve

            const hint = await this.titleCategoryHintService.suggestCategory(event.titleId);
            if (!hint) return;

            await this.productService.updateCategory(event.productId, { id: hint.categoryId });

            this.logger.log(
                `Product ${event.productId}: categoria aplicada automaticamente via titleId (categoria="${hint.categoryName}", count=${hint.count})`,
            );
        } catch (err) {
            this.logger.error(
                `TitleCategoryAutoApply falhou (productId=${event.productId}): ${(err as Error).message}`,
            );
        }
    }
}
