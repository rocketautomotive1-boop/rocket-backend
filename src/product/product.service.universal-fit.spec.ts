import { Types } from 'mongoose';
import { ProductService } from './product.service';

/**
 * Foco em ProductService.update — toggle isUniversalFit + limpeza de
 * compatibilidades salvas. As demais dependências do construtor são stubs
 * vazios pois este comportamento não as toca.
 */
describe('ProductService.update — isUniversalFit', () => {
    let service: ProductService;
    let productRepository: { save: jest.Mock; findOne: jest.Mock; findOneRaw: jest.Mock; findByIdClean: jest.Mock };
    let productCompatibilityService: { deleteAllForProduct: jest.Mock };
    let existingProduct: any;

    beforeEach(() => {
        existingProduct = {
            _id: new Types.ObjectId(),
            name: 'CAPA2936',
            partNumber: 'CAPA2936',
            slug: 'capa2936-capa2936',
            isUniversalFit: false,
        };

        productRepository = {
            findOne: jest.fn().mockResolvedValue(existingProduct),
            findOneRaw: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation(async (doc) => doc),
            findByIdClean: jest.fn().mockResolvedValue({ id: String(existingProduct._id) }),
        };
        productCompatibilityService = { deleteAllForProduct: jest.fn().mockResolvedValue(3) };

        const noop: any = {};
        const eventEmitter = { emit: jest.fn() };

        service = new ProductService(
            productRepository as any,
            noop, // STOCK_QUERY_PORT
            noop, // STORE_AWARE_STOCK_QUERY_PORT
            noop, // STORE_OWNER_LOOKUP_PORT
            noop, // STORE_PORT
            { setBasePrice: jest.fn(), setPricingMeta: jest.fn(), setPromotion: jest.fn(), clearPromotion: jest.fn() } as any, // PRICING_PORT
            noop, // queueService
            productCompatibilityService as any,
            noop, // productFilterService
            noop, // marketplaceRegistry
            noop, // stockService
            noop, // marketplaceDescriptionService
            noop, // publicationLogService
            noop, // categoryMappingService
            noop, // productTitleService
            noop, // userProductivityService
            { updateProductCounts: jest.fn().mockResolvedValue(undefined) } as any, // productCategoryService
            noop, // titleCategoryHintService
            { createOrGet: jest.fn() } as any, // productShortTitleService
            noop, // mercadoLivreCompatibilityAdapter
            noop, // brandModel
            noop, // productDiscoveryModel
            eventEmitter as any,
            noop, // productReadinessService
            noop, // orchestratorPublisher
        );
    });

    afterEach(() => jest.clearAllMocks());

    it('ativa isUniversalFit e remove todas as compatibilidades salvas', async () => {
        const result = await service.update(String(existingProduct._id), { isUniversalFit: true });

        expect(existingProduct.isUniversalFit).toBe(true);
        expect(productCompatibilityService.deleteAllForProduct).toHaveBeenCalledWith(String(existingProduct._id));
        expect((result as any).removedCompatibilitiesCount).toBe(3);
    });

    it('desativa isUniversalFit sem tocar em compatibilidades', async () => {
        existingProduct.isUniversalFit = true;
        const result = await service.update(String(existingProduct._id), { isUniversalFit: false });

        expect(existingProduct.isUniversalFit).toBe(false);
        expect(productCompatibilityService.deleteAllForProduct).not.toHaveBeenCalled();
        expect((result as any).removedCompatibilitiesCount).toBeUndefined();
    });

    it('não mexe em isUniversalFit quando o campo não é enviado', async () => {
        await service.update(String(existingProduct._id), { description: 'x' });

        expect(existingProduct.isUniversalFit).toBe(false);
        expect(productCompatibilityService.deleteAllForProduct).not.toHaveBeenCalled();
    });
});
