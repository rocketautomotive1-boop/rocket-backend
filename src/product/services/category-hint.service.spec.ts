import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CategoryHintService } from './category-hint.service';
import { CategoryHintModel } from '../schemas/category-hint.schema';
import { CategoryModel } from '../schemas/category.schema';
import { DisplayNameSynonymCandidateService } from './display-name-synonym-candidate.service';

describe('CategoryHintService', () => {
    let service: CategoryHintService;
    let categoryHintModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
    let categoryModel: { findById: jest.Mock };
    let synonymCandidateService: { checkAndEnqueue: jest.Mock; resolveCanonical: jest.Mock };

    beforeEach(async () => {
        categoryHintModel = {
            findOneAndUpdate: jest.fn(),
            findOne: jest.fn(),
        };
        categoryModel = {
            findById: jest.fn(),
        };
        synonymCandidateService = {
            checkAndEnqueue: jest.fn().mockResolvedValue(undefined),
            resolveCanonical: jest.fn().mockImplementation((term: string) => Promise.resolve(term)),
        };

        const module = await Test.createTestingModule({
            providers: [
                CategoryHintService,
                { provide: getModelToken(CategoryHintModel.name), useValue: categoryHintModel },
                { provide: getModelToken(CategoryModel.name), useValue: categoryModel },
                { provide: DisplayNameSynonymCandidateService, useValue: synonymCandidateService },
            ],
        }).compile();

        service = module.get(CategoryHintService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('recordHint', () => {
        it('faz upsert incrementando count com displayName normalizado', async () => {
            const categoryId = new Types.ObjectId().toString();
            categoryHintModel.findOneAndUpdate.mockResolvedValue({ count: 1 });

            await service.recordHint('  Disco de Embreagem  ', categoryId);

            expect(categoryHintModel.findOneAndUpdate).toHaveBeenCalledWith(
                { displayNameNormalized: 'disco de embreagem', categoryId: new Types.ObjectId(categoryId) },
                { $inc: { count: 1 }, $set: { lastUsedAt: expect.any(Date) } },
                { upsert: true, new: true },
            );
        });

        it('não chama o model quando displayName é vazio', async () => {
            await service.recordHint('   ', new Types.ObjectId().toString());
            expect(categoryHintModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('não chama o model quando categoryId é inválido', async () => {
            await service.recordHint('Disco de Embreagem', 'not-an-object-id');
            expect(categoryHintModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('aciona a mineração de sinônimo candidato após o upsert', async () => {
            const categoryId = new Types.ObjectId().toString();
            categoryHintModel.findOneAndUpdate.mockResolvedValue({ count: 3 });

            await service.recordHint('Painel de Porta', categoryId);

            expect(synonymCandidateService.checkAndEnqueue).toHaveBeenCalledWith(
                'painel de porta',
                new Types.ObjectId(categoryId),
                3,
            );
        });
    });

    describe('suggestCategory', () => {
        it('retorna null quando displayName é vazio', async () => {
            const result = await service.suggestCategory('   ');
            expect(result).toBeNull();
            expect(categoryHintModel.findOne).not.toHaveBeenCalled();
        });

        it('retorna null quando não há hint para o displayName', async () => {
            categoryHintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.suggestCategory('Disco de Embreagem');
            expect(result).toBeNull();
        });

        it('retorna o hint de maior count, populando o nome da categoria', async () => {
            const categoryId = new Types.ObjectId();
            categoryHintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ categoryId, count: 7 }),
            });
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ name: 'Disco de Embreagens' }),
            });

            const result = await service.suggestCategory('disco de embreagem');

            expect(result).toEqual({
                categoryId: String(categoryId),
                categoryName: 'Disco de Embreagens',
                count: 7,
            });
        });

        it('retorna null quando a categoria referenciada pelo hint não existe mais', async () => {
            categoryHintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ categoryId: new Types.ObjectId(), count: 3 }),
            });
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.suggestCategory('Disco de Embreagem');
            expect(result).toBeNull();
        });

        it('resolve o termo digitado para o displayName canônico via sinônimo antes de buscar o hint', async () => {
            const categoryId = new Types.ObjectId();
            synonymCandidateService.resolveCanonical.mockResolvedValue('forro de porta');
            categoryHintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ categoryId, count: 40 }),
            });
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ name: 'Forro de Porta' }),
            });

            const result = await service.suggestCategory('Painel de Porta');

            expect(synonymCandidateService.resolveCanonical).toHaveBeenCalledWith('painel de porta');
            expect(categoryHintModel.findOne).toHaveBeenCalledWith({ displayNameNormalized: 'forro de porta' });
            expect(result?.categoryName).toBe('Forro de Porta');
        });
    });
});
