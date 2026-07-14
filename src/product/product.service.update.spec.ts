import { Types } from 'mongoose';
import { ProductService } from './product.service';
import { CategoryHintService } from './services/category-hint.service';

/**
 * Foco em ProductService.update — só cobre o comportamento novo (displayName +
 * recordHint), não o método inteiro. As demais dependências do construtor são
 * stubs vazios pois update() não as toca.
 */
describe('ProductService.update — displayName + category hint', () => {
    let service: ProductService;
    let productRepository: { save: jest.Mock; findOne: jest.Mock; findOneRaw: jest.Mock; findByIdClean: jest.Mock };
    let categoryHintService: { recordHint: jest.Mock };
    let productCategoryService: { updateProductCounts: jest.Mock };
    let existingProduct: any;

    beforeEach(() => {
        existingProduct = {
            _id: new Types.ObjectId(),
            name: 'CAPA2936',
            partNumber: 'CAPA2936',
            slug: 'capa2936-capa2936',
            displayName: undefined,
        };

        productRepository = {
            findOne: jest.fn().mockResolvedValue(existingProduct),
            findOneRaw: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation(async (doc) => doc),
            findByIdClean: jest.fn().mockResolvedValue({ id: String(existingProduct._id) }),
        };
        categoryHintService = { recordHint: jest.fn().mockResolvedValue(undefined) };
        productCategoryService = { updateProductCounts: jest.fn().mockResolvedValue(undefined) };

        const noop: any = {};
        const eventEmitter = { emit: jest.fn() };

        service = new ProductService(
            productRepository as any,
            noop, // STOCK_QUERY_PORT
            { setBasePrice: jest.fn(), setPricingMeta: jest.fn(), setPromotion: jest.fn(), clearPromotion: jest.fn() } as any, // PRICING_PORT
            noop, // queueService
            noop, // productCompatibilityService
            noop, // productFilterService
            noop, // marketplaceRegistry
            noop, // stockService
            noop, // marketplaceDescriptionService
            noop, // publicationLogService
            noop, // categoryMappingService
            noop, // productTitleService
            noop, // userProductivityService
            productCategoryService as any,
            categoryHintService as any,
            noop, // mercadoLivreCompatibilityAdapter
            noop, // brandModel
            noop, // productDiscoveryModel
            eventEmitter as any,
            noop, // productReadinessService
        );
    });

    afterEach(() => jest.clearAllMocks());

    it('chama recordHint quando displayName e category estão presentes', async () => {
        const categoryId = new Types.ObjectId().toString();
        await service.update(String(existingProduct._id), { displayName: 'Disco de Embreagem', category: categoryId });

        expect(categoryHintService.recordHint).toHaveBeenCalledWith('Disco de Embreagem', categoryId);
    });

    it('não chama recordHint quando falta category', async () => {
        await service.update(String(existingProduct._id), { displayName: 'Disco de Embreagem' });
        expect(categoryHintService.recordHint).not.toHaveBeenCalled();
    });

    it('não chama recordHint quando falta displayName', async () => {
        const categoryId = new Types.ObjectId().toString();
        await service.update(String(existingProduct._id), { category: categoryId });
        expect(categoryHintService.recordHint).not.toHaveBeenCalled();
    });

    it('persiste displayName no documento do produto', async () => {
        await service.update(String(existingProduct._id), { displayName: 'Disco de Embreagem' });
        expect(existingProduct.displayName).toBe('Disco de Embreagem');
    });

    it('regenera o slug quando displayName é setado e o slug atual ainda reflete name/partNumber', async () => {
        await service.update(String(existingProduct._id), { displayName: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-combustivel-capa2936');
    });

    it('não regenera o slug quando ele já reflete um displayName anterior', async () => {
        existingProduct.slug = 'filtro-de-oleo-capa2936';
        await service.update(String(existingProduct._id), { displayName: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-oleo-capa2936');
    });

    it('inclui brand.shortName no slug regenerado quando o produto já tem marca', async () => {
        existingProduct.brand = { _id: 'b1', name: 'Mitsubishi', shortName: 'Mitsubishi' };
        existingProduct.slug = 'capa2936-mitsubishi-capa2936';
        await service.update(String(existingProduct._id), { displayName: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-combustivel-mitsubishi-capa2936');
    });
});
