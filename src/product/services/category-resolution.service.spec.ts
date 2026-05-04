import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CategoryResolutionService } from './category-resolution.service';
import { CategoryModel } from '../schemas/category.schema';
import { Types } from 'mongoose';

const makeCategory = (overrides: Partial<any> = {}) => ({
    _id: new Types.ObjectId(),
    name: 'Filtros de Óleo',
    slug: 'filtros-de-oleo',
    active: true,
    relevance: 80,
    synonyms: ['Filtro de Óleo Motor'],
    marketplaceMappings: [
        {
            marketplaceId: new Types.ObjectId(),
            externalId: 'MLB123',
            externalName: 'Filtros de Óleo',
            path: 'Autopeças > Filtros > Filtro de Óleo',
        },
    ],
    ...overrides,
});

describe('CategoryResolutionService', () => {
    let service: CategoryResolutionService;
    let categoryModel: { findOne: jest.Mock; find: jest.Mock };

    beforeEach(async () => {
        categoryModel = {
            findOne: jest.fn(),
            find: jest.fn(),
        };

        const module = await Test.createTestingModule({
            providers: [
                CategoryResolutionService,
                {
                    provide: getModelToken(CategoryModel.name),
                    useValue: categoryModel,
                },
            ],
        }).compile();

        service = module.get(CategoryResolutionService);
    });

    afterEach(() => jest.clearAllMocks());

    it('retorna null quando categoryPath é null', async () => {
        const result = await service.resolve(null);
        expect(result).toBeNull();
        expect(categoryModel.findOne).not.toHaveBeenCalled();
    });

    it('retorna null quando categoryPath é string vazia ou só espaços', async () => {
        expect(await service.resolve('')).toBeNull();
        expect(await service.resolve('   ')).toBeNull();
        expect(categoryModel.findOne).not.toHaveBeenCalled();
    });

    it('match exato por marketplaceMappings[].path', async () => {
        const cat = makeCategory();
        categoryModel.findOne.mockImplementation((query: any) => {
            if (query['marketplaceMappings.path']) return Promise.resolve(cat);
            return Promise.resolve(null);
        });

        const result = await service.resolve('Autopeças > Filtros > Filtro de Óleo');

        expect(result).toEqual(cat._id);
        expect(categoryModel.findOne).toHaveBeenCalledTimes(1);
    });

    it('match por nó folha em name', async () => {
        const cat = makeCategory({ name: 'Filtros de Óleo' });
        categoryModel.findOne.mockImplementation((query: any) => {
            if (query['marketplaceMappings.path']) return Promise.resolve(null);
            if (query.$or) return Promise.resolve(cat);
            return Promise.resolve(null);
        });

        const result = await service.resolve('Autopeças > Filtros > Filtros de Óleo');

        expect(result).toEqual(cat._id);
    });

    it('match por nó folha em synonyms', async () => {
        const cat = makeCategory({ name: 'Filtros', synonyms: ['Filtros de Óleo Motor'] });
        categoryModel.findOne.mockImplementation((query: any) => {
            if (query['marketplaceMappings.path']) return Promise.resolve(null);
            if (query.$or) return Promise.resolve(cat);
            return Promise.resolve(null);
        });

        const result = await service.resolve('Autopeças > Filtros de Óleo Motor');

        expect(result).toEqual(cat._id);
    });

    it('match por tokens com sort por relevance', async () => {
        const cat = makeCategory({ relevance: 90 });
        categoryModel.findOne.mockResolvedValue(null);
        categoryModel.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                    lean: jest.fn().mockReturnValue({
                        exec: jest.fn().mockResolvedValue([cat]),
                    }),
                }),
            }),
        });

        const result = await service.resolve('Acessórios para Veículos > Peças > Filtros');

        expect(result).toEqual(cat._id);
    });

    it('retorna null quando nenhum match encontrado', async () => {
        categoryModel.findOne.mockResolvedValue(null);
        categoryModel.find.mockReturnValue({
            sort: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                    lean: jest.fn().mockReturnValue({
                        exec: jest.fn().mockResolvedValue([]),
                    }),
                }),
            }),
        });

        const result = await service.resolve('Categoria Inexistente > Subcategoria');

        expect(result).toBeNull();
    });
});
