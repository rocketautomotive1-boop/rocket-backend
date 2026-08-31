import { Types } from 'mongoose';
import { ProductService } from './product.service';

/**
 * Foco em ProductService.update — só cobre o comportamento novo (title/subtitle
 * via ProductShortTitle + recordHint), não o método inteiro. As demais
 * dependências do construtor são stubs vazios pois update() não as toca.
 */
describe('ProductService.update — title/subtitle + category hint', () => {
    let service: ProductService;
    let productRepository: { save: jest.Mock; findOne: jest.Mock; findOneRaw: jest.Mock; findByIdClean: jest.Mock };
    let titleCategoryHintService: { recordHint: jest.Mock; invalidateHint: jest.Mock };
    let productShortTitleService: { createOrGet: jest.Mock };
    let productCategoryService: { updateProductCounts: jest.Mock };
    let existingProduct: any;
    let shortTitleDoc: { _id: Types.ObjectId; text: string; synonyms: string[] };

    beforeEach(() => {
        existingProduct = {
            _id: new Types.ObjectId(),
            name: 'CAPA2936',
            partNumber: 'CAPA2936',
            slug: 'capa2936-capa2936',
            titleId: undefined,
            titleText: undefined,
            subtitle: undefined,
        };

        shortTitleDoc = { _id: new Types.ObjectId(), text: 'Disco de Embreagem', synonyms: [] };

        productRepository = {
            findOne: jest.fn().mockResolvedValue(existingProduct),
            findOneRaw: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation(async (doc) => doc),
            findByIdClean: jest.fn().mockResolvedValue({ id: String(existingProduct._id) }),
        };
        titleCategoryHintService = {
            recordHint: jest.fn().mockResolvedValue(undefined),
            invalidateHint: jest.fn().mockResolvedValue(undefined),
        };
        productShortTitleService = {
            createOrGet: jest.fn().mockImplementation((text: string) =>
                Promise.resolve({ ...shortTitleDoc, text, synonyms: [] }),
            ),
        };
        productCategoryService = { updateProductCounts: jest.fn().mockResolvedValue(undefined) };

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
            titleCategoryHintService as any,
            productShortTitleService as any,
            noop, // mercadoLivreCompatibilityAdapter
            noop, // brandModel
            noop, // productDiscoveryModel
            eventEmitter as any,
            noop, // productReadinessService
            noop, // orchestratorPublisher
        );
    });

    afterEach(() => jest.clearAllMocks());

    it('chama recordHint com titleId quando title e category estão presentes', async () => {
        const categoryId = new Types.ObjectId().toString();
        await service.update(String(existingProduct._id), { title: 'Disco de Embreagem', category: categoryId });

        expect(productShortTitleService.createOrGet).toHaveBeenCalledWith('Disco de Embreagem');
        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(String(shortTitleDoc._id), categoryId);
    });

    it('não chama recordHint quando falta category e o produto não tem categoria salva', async () => {
        await service.update(String(existingProduct._id), { title: 'Disco de Embreagem' });
        expect(titleCategoryHintService.recordHint).not.toHaveBeenCalled();
    });

    it('chama recordHint com a categoria JÁ salva no produto quando só title é enviado', async () => {
        const existingCategoryId = new Types.ObjectId();
        existingProduct.category = existingCategoryId;

        await service.update(String(existingProduct._id), { title: 'Disco de Embreagem' });

        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(
            String(shortTitleDoc._id),
            String(existingCategoryId),
        );
    });

    it('chama recordHint com o _id extraído quando product.category vem populado (ProductRepository.findOne)', async () => {
        // findDocument() usa ProductRepository.findOne, que faz .populate('category') — product.category
        // chega como o documento inteiro (não um ObjectId bruto). String() nesse objeto vira
        // "[object Object]", que falha Types.ObjectId.isValid() e silenciosamente não grava o hint.
        const existingCategoryId = new Types.ObjectId();
        existingProduct.category = { _id: existingCategoryId, name: 'Categoria Populada', hidden: false };

        await service.update(String(existingProduct._id), { title: 'Disco de Embreagem' });

        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(
            String(shortTitleDoc._id),
            String(existingCategoryId),
        );
    });

    it('não chama recordHint quando falta title e o produto não tem titleId salvo', async () => {
        const categoryId = new Types.ObjectId().toString();
        await service.update(String(existingProduct._id), { category: categoryId });
        expect(titleCategoryHintService.recordHint).not.toHaveBeenCalled();
        expect(productShortTitleService.createOrGet).not.toHaveBeenCalled();
    });

    it('chama recordHint com o titleId JÁ salvo no produto quando só category é enviado', async () => {
        const existingTitleId = new Types.ObjectId();
        existingProduct.titleId = existingTitleId;
        const categoryId = new Types.ObjectId().toString();

        await service.update(String(existingProduct._id), { category: categoryId });

        expect(productShortTitleService.createOrGet).not.toHaveBeenCalled();
        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(String(existingTitleId), categoryId);
    });

    it('invalida o hint da categoria anterior ao trocar a categoria de um produto com titleId', async () => {
        const existingTitleId = new Types.ObjectId();
        const oldCategoryId = new Types.ObjectId();
        existingProduct.titleId = existingTitleId;
        existingProduct.category = oldCategoryId;
        const newCategoryId = new Types.ObjectId().toString();

        await service.update(String(existingProduct._id), { category: newCategoryId });

        expect(titleCategoryHintService.invalidateHint).toHaveBeenCalledWith(String(existingTitleId), String(oldCategoryId));
        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(String(existingTitleId), newCategoryId);
    });

    it('não invalida hint quando a categoria enviada é a mesma que o produto já tinha', async () => {
        const existingTitleId = new Types.ObjectId();
        const sameCategoryId = new Types.ObjectId();
        existingProduct.titleId = existingTitleId;
        existingProduct.category = sameCategoryId;

        await service.update(String(existingProduct._id), { category: String(sameCategoryId) });

        expect(titleCategoryHintService.invalidateHint).not.toHaveBeenCalled();
    });

    it('não invalida hint quando o produto não tinha categoria anterior', async () => {
        const existingTitleId = new Types.ObjectId();
        existingProduct.titleId = existingTitleId;
        existingProduct.category = undefined;
        const newCategoryId = new Types.ObjectId().toString();

        await service.update(String(existingProduct._id), { category: newCategoryId });

        expect(titleCategoryHintService.invalidateHint).not.toHaveBeenCalled();
        expect(titleCategoryHintService.recordHint).toHaveBeenCalledWith(String(existingTitleId), newCategoryId);
    });

    it('persiste titleId/titleText/titleSynonyms no documento do produto', async () => {
        await service.update(String(existingProduct._id), { title: 'Disco de Embreagem' });
        expect(String(existingProduct.titleId)).toBe(String(shortTitleDoc._id));
        expect(existingProduct.titleText).toBe('Disco de Embreagem');
        expect(existingProduct.titleSynonyms).toEqual([]);
    });

    it('persiste subtitle como texto livre, sem passar por ProductShortTitleService', async () => {
        await service.update(String(existingProduct._id), { subtitle: 'Dianteiro do Virabrequim' });
        expect(existingProduct.subtitle).toBe('Dianteiro do Virabrequim');
        expect(productShortTitleService.createOrGet).not.toHaveBeenCalled();
    });

    it('regenera o slug quando title é setado e o slug atual ainda reflete name/partNumber', async () => {
        await service.update(String(existingProduct._id), { title: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-combustivel-capa2936');
    });

    it('não regenera o slug quando ele já reflete um title anterior', async () => {
        existingProduct.slug = 'filtro-de-oleo-capa2936';
        await service.update(String(existingProduct._id), { title: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-oleo-capa2936');
    });

    it('inclui brand.shortName no slug regenerado quando o produto já tem marca', async () => {
        existingProduct.brand = { _id: 'b1', name: 'Mitsubishi', shortName: 'Mitsubishi' };
        existingProduct.slug = 'capa2936-mitsubishi-capa2936';
        await service.update(String(existingProduct._id), { title: 'Filtro de combustível' });
        expect(existingProduct.slug).toBe('filtro-de-combustivel-mitsubishi-capa2936');
    });
});
