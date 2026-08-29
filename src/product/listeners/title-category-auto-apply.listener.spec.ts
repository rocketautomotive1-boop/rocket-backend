import { Test } from '@nestjs/testing';
import { TitleCategoryAutoApplyListener } from './title-category-auto-apply.listener';
import { TitleCategoryHintService } from '../services/title-category-hint.service';
import { ProductRepository } from '../product.repository';
import { ProductService } from '../product.service';
import { ProductTitleIdResolvedEvent } from '../events/product-section-saved.event';

describe('TitleCategoryAutoApplyListener', () => {
    let listener: TitleCategoryAutoApplyListener;
    let titleCategoryHintService: { suggestCategory: jest.Mock };
    let productRepository: { findByIdClean: jest.Mock };
    let productService: { updateCategory: jest.Mock };

    const productId = 'product-1';
    const titleId = 'title-1';

    beforeEach(async () => {
        titleCategoryHintService = { suggestCategory: jest.fn() };
        productRepository = { findByIdClean: jest.fn() };
        productService = { updateCategory: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                TitleCategoryAutoApplyListener,
                { provide: TitleCategoryHintService, useValue: titleCategoryHintService },
                { provide: ProductRepository, useValue: productRepository },
                { provide: ProductService, useValue: productService },
            ],
        }).compile();

        listener = module.get(TitleCategoryAutoApplyListener);
    });

    it('aplica a categoria sugerida quando o produto ainda não tem category', async () => {
        productRepository.findByIdClean.mockResolvedValue({ _id: productId, category: undefined });
        titleCategoryHintService.suggestCategory.mockResolvedValue({
            categoryId: 'cat-1',
            categoryName: 'Air Bags',
            count: 3,
        });

        await listener.onTitleIdResolved(new ProductTitleIdResolvedEvent(productId, titleId));

        expect(titleCategoryHintService.suggestCategory).toHaveBeenCalledWith(titleId);
        expect(productService.updateCategory).toHaveBeenCalledWith(productId, { id: 'cat-1' });
    });

    it('não faz nada quando o produto já tem category (nunca sobrescreve)', async () => {
        productRepository.findByIdClean.mockResolvedValue({ _id: productId, category: 'cat-existing' });

        await listener.onTitleIdResolved(new ProductTitleIdResolvedEvent(productId, titleId));

        expect(titleCategoryHintService.suggestCategory).not.toHaveBeenCalled();
        expect(productService.updateCategory).not.toHaveBeenCalled();
    });

    it('não faz nada quando não há sugestão de categoria com confiança suficiente', async () => {
        productRepository.findByIdClean.mockResolvedValue({ _id: productId, category: undefined });
        titleCategoryHintService.suggestCategory.mockResolvedValue(null);

        await listener.onTitleIdResolved(new ProductTitleIdResolvedEvent(productId, titleId));

        expect(productService.updateCategory).not.toHaveBeenCalled();
    });

    it('não faz nada quando o produto não existe mais', async () => {
        productRepository.findByIdClean.mockResolvedValue(null);

        await listener.onTitleIdResolved(new ProductTitleIdResolvedEvent(productId, titleId));

        expect(titleCategoryHintService.suggestCategory).not.toHaveBeenCalled();
        expect(productService.updateCategory).not.toHaveBeenCalled();
    });

    it('engole erros sem propagar exceção', async () => {
        productRepository.findByIdClean.mockRejectedValue(new Error('db down'));

        await expect(
            listener.onTitleIdResolved(new ProductTitleIdResolvedEvent(productId, titleId)),
        ).resolves.toBeUndefined();
    });
});
