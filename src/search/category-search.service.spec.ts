import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CategorySearchService } from './category-search.service';
import { CategoryModel } from '../product/schemas/category.schema';

describe('CategorySearchService', () => {
    let service: CategorySearchService;
    let categoryModel: { find: jest.Mock };

    const mockFind = (categories: any[]) => {
        categoryModel.find.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(categories),
        });
    };

    beforeEach(async () => {
        categoryModel = { find: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                CategorySearchService,
                { provide: getModelToken(CategoryModel.name), useValue: categoryModel },
            ],
        }).compile();

        service = module.get(CategorySearchService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('getTree', () => {
        it('remove folha sem produto e pai que fica sem descendentes com produto', async () => {
            const parentId = new Types.ObjectId();
            const leafId = new Types.ObjectId();
            mockFind([
                { _id: parentId, name: 'Motor', parentId: undefined, productCount: 0 },
                { _id: leafId, name: 'Pistões', parentId, productCount: 0 },
            ]);

            const tree = await service.getTree();

            expect(tree).toEqual([]);
        });

        it('mantém pai sem produto direto se algum filho tiver produto', async () => {
            const parentId = new Types.ObjectId();
            const leafId = new Types.ObjectId();
            mockFind([
                { _id: parentId, name: 'Motor', parentId: undefined, productCount: 0 },
                { _id: leafId, name: 'Pistões', parentId, productCount: 3 },
            ]);

            const tree = await service.getTree();

            expect(tree).toHaveLength(1);
            expect(tree[0].name).toBe('Motor');
            expect(tree[0].children).toHaveLength(1);
            expect(tree[0].children[0].name).toBe('Pistões');
        });

        it('mantém folha com produto próprio', async () => {
            const leafId = new Types.ObjectId();
            mockFind([
                { _id: leafId, name: 'Óleo de Motor', parentId: undefined, productCount: 5 },
            ]);

            const tree = await service.getTree();

            expect(tree).toHaveLength(1);
            expect(tree[0].name).toBe('Óleo de Motor');
        });

        it('retorna [] em caso de erro na query', async () => {
            categoryModel.find.mockImplementation(() => {
                throw new Error('boom');
            });

            const tree = await service.getTree();

            expect(tree).toEqual([]);
        });

        it('remove categoria hidden e toda a subárvore, mesmo com produto', async () => {
            const parentId = new Types.ObjectId();
            const leafId = new Types.ObjectId();
            mockFind([
                { _id: parentId, name: 'Alimentos e Bebidas', parentId: undefined, hidden: true, productCount: 0 },
                { _id: leafId, name: 'Snacks', parentId, ancestors: [parentId], hidden: false, productCount: 10 },
            ]);

            const tree = await service.getTree();

            expect(tree).toEqual([]);
        });

        it('mantém irmã visível quando só uma categoria é hidden', async () => {
            const hiddenId = new Types.ObjectId();
            const visibleId = new Types.ObjectId();
            mockFind([
                { _id: hiddenId, name: 'Saúde', parentId: undefined, hidden: true, productCount: 5 },
                { _id: visibleId, name: 'Motor', parentId: undefined, hidden: false, productCount: 5 },
            ]);

            const tree = await service.getTree();

            expect(tree).toHaveLength(1);
            expect(tree[0].name).toBe('Motor');
        });
    });

    describe('searchCategories', () => {
        it('busca por nome sobre a árvore já podada e mapeia id', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Óleo de Motor', slug: 'oleo-de-motor', parentId: undefined, productCount: 3, relevance: 90 },
            ]);

            const results = await service.searchCategories('Óleo');

            expect(results).toEqual([
                { id: categoryId.toString(), _id: categoryId, name: 'Óleo de Motor', slug: 'oleo-de-motor', breadcrumbs: undefined, relevance: 90 },
            ]);
        });

        it('não retorna categoria sem produto (mesma regra da árvore)', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Óleo de Motor', slug: 'oleo-de-motor', parentId: undefined, productCount: 0 },
            ]);

            const results = await service.searchCategories('oleo');

            expect(results).toEqual([]);
        });

        it('não retorna categoria marcada hidden mesmo com produto', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Suplementos', slug: 'suplementos', parentId: undefined, hidden: true, productCount: 5 },
            ]);

            const results = await service.searchCategories('suplementos');

            expect(results).toEqual([]);
        });

        it('escapa caracteres especiais de regex no termo de busca', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'a.b*c(', slug: 'x', parentId: undefined, productCount: 1 },
            ]);

            const results = await service.searchCategories('a.b*c(');

            expect(results).toHaveLength(1);
        });

        it('busca multi-palavra encontra nome com palavras fora de ordem/adjacência ("forro porta" acha "Forro de Porta")', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Forro de Porta', slug: 'forro-de-porta', parentId: undefined, productCount: 1 },
            ]);

            const results = await service.searchCategories('forro porta');

            expect(results).toHaveLength(1);
        });

        it('busca ignora acentuação em ambos os sentidos', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Óleo de Motor', slug: 'oleo-de-motor', parentId: undefined, productCount: 1 },
            ]);

            const results = await service.searchCategories('oleo motor');

            expect(results).toHaveLength(1);
        });

        it('busca acentuada encontra nome sem acento', async () => {
            const categoryId = new Types.ObjectId();
            mockFind([
                { _id: categoryId, name: 'Filtro de Ar', slug: 'filtro-de-ar', parentId: undefined, productCount: 1 },
            ]);

            const results = await service.searchCategories('filtró dé ár');

            expect(results).toHaveLength(1);
        });

        it('retorna [] em caso de erro na query', async () => {
            categoryModel.find.mockImplementation(() => {
                throw new Error('boom');
            });

            const results = await service.searchCategories('oleo');

            expect(results).toEqual([]);
        });
    });
});
