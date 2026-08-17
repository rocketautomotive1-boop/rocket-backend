import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TitleCategoryHintService } from './title-category-hint.service';
import { TitleCategoryHintModel } from '../schemas/title-category-hint.schema';
import { CategoryModel } from '../schemas/category.schema';

describe('TitleCategoryHintService', () => {
    let service: TitleCategoryHintService;
    let hintModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock; find: jest.Mock; deleteOne: jest.Mock };
    let categoryModel: { findById: jest.Mock };

    beforeEach(async () => {
        hintModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn(), find: jest.fn(), deleteOne: jest.fn() };
        categoryModel = { findById: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                TitleCategoryHintService,
                { provide: getModelToken(TitleCategoryHintModel.name), useValue: hintModel },
                { provide: getModelToken(CategoryModel.name), useValue: categoryModel },
            ],
        }).compile();

        service = module.get(TitleCategoryHintService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('recordHint', () => {
        it('faz upsert incrementando count', async () => {
            const titleId = new Types.ObjectId().toString();
            const categoryId = new Types.ObjectId().toString();
            hintModel.findOneAndUpdate.mockResolvedValue({ count: 1 });

            await service.recordHint(titleId, categoryId);

            expect(hintModel.findOneAndUpdate).toHaveBeenCalledWith(
                { titleId: new Types.ObjectId(titleId), categoryId: new Types.ObjectId(categoryId) },
                { $inc: { count: 1 }, $set: { lastUsedAt: expect.any(Date) } },
                { upsert: true, new: true },
            );
        });

        it('não chama o model quando titleId é inválido', async () => {
            await service.recordHint('not-an-object-id', new Types.ObjectId().toString());
            expect(hintModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('não chama o model quando categoryId é inválido', async () => {
            await service.recordHint(new Types.ObjectId().toString(), 'not-an-object-id');
            expect(hintModel.findOneAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('suggestCategory', () => {
        // suggestCategory agora busca os 2 hints de maior count (find().sort().limit(2)) em vez de
        // findOne, para poder detectar empate/ambiguidade antes de sugerir.
        function mockTopHints(hints: { categoryId: Types.ObjectId; count: number }[]) {
            hintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(hints),
            });
        }

        it('retorna null quando titleId é inválido', async () => {
            const result = await service.suggestCategory('not-an-object-id');
            expect(result).toBeNull();
            expect(hintModel.find).not.toHaveBeenCalled();
        });

        it('retorna null quando não há hint para o titleId', async () => {
            mockTopHints([]);

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });

        it('retorna null quando o hint de maior count tem count menor que 2 (sem confiança suficiente)', async () => {
            mockTopHints([{ categoryId: new Types.ObjectId(), count: 1 }]);

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });

        it('retorna null quando os dois hints mais votados empatam em count (ambíguo)', async () => {
            mockTopHints([
                { categoryId: new Types.ObjectId(), count: 2 },
                { categoryId: new Types.ObjectId(), count: 2 },
            ]);

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });

        it('retorna o hint de maior count quando count >= 2 e não há empate, populando o nome da categoria', async () => {
            const titleId = new Types.ObjectId().toString();
            const categoryId = new Types.ObjectId();
            mockTopHints([
                { categoryId, count: 7 },
                { categoryId: new Types.ObjectId(), count: 3 },
            ]);
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ name: 'Parafusos' }),
            });

            const result = await service.suggestCategory(titleId);

            expect(hintModel.find).toHaveBeenCalledWith({ titleId: new Types.ObjectId(titleId) });
            expect(result).toEqual({ categoryId: String(categoryId), categoryName: 'Parafusos', count: 7 });
        });

        it('retorna null quando a categoria referenciada pelo hint não existe mais', async () => {
            mockTopHints([{ categoryId: new Types.ObjectId(), count: 3 }]);
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });
    });

    describe('listHints', () => {
        it('retorna [] quando titleId é inválido', async () => {
            const result = await service.listHints('not-an-object-id');
            expect(result).toEqual([]);
            expect(hintModel.find).not.toHaveBeenCalled();
        });

        it('retorna todos os hints do título, ordenados por count desc, com nome da categoria populado', async () => {
            const titleId = new Types.ObjectId().toString();
            const categoryIdA = new Types.ObjectId();
            const categoryIdB = new Types.ObjectId();
            const lastUsedAtA = new Date('2026-08-01');
            const lastUsedAtB = new Date('2026-08-10');

            hintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                populate: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    { categoryId: { _id: categoryIdA, name: 'Parafusos' }, count: 7, lastUsedAt: lastUsedAtA },
                    { categoryId: { _id: categoryIdB, name: 'Porcas' }, count: 3, lastUsedAt: lastUsedAtB },
                ]),
            });

            const result = await service.listHints(titleId);

            expect(hintModel.find).toHaveBeenCalledWith({ titleId: new Types.ObjectId(titleId) });
            expect(result).toEqual([
                { categoryId: String(categoryIdA), categoryName: 'Parafusos', count: 7, lastUsedAt: lastUsedAtA },
                { categoryId: String(categoryIdB), categoryName: 'Porcas', count: 3, lastUsedAt: lastUsedAtB },
            ]);
        });

        it('ignora hints cuja categoria referenciada não existe mais', async () => {
            const titleId = new Types.ObjectId().toString();
            hintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                populate: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    { categoryId: null, count: 5, lastUsedAt: new Date() },
                ]),
            });

            const result = await service.listHints(titleId);
            expect(result).toEqual([]);
        });
    });

    describe('invalidateHint', () => {
        it('remove o hint específico titleId+categoryId', async () => {
            const titleId = new Types.ObjectId().toString();
            const categoryId = new Types.ObjectId().toString();
            hintModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

            await service.invalidateHint(titleId, categoryId);

            expect(hintModel.deleteOne).toHaveBeenCalledWith({
                titleId: new Types.ObjectId(titleId),
                categoryId: new Types.ObjectId(categoryId),
            });
        });

        it('não chama o model quando titleId é inválido', async () => {
            await service.invalidateHint('not-an-object-id', new Types.ObjectId().toString());
            expect(hintModel.deleteOne).not.toHaveBeenCalled();
        });

        it('não chama o model quando categoryId é inválido', async () => {
            await service.invalidateHint(new Types.ObjectId().toString(), 'not-an-object-id');
            expect(hintModel.deleteOne).not.toHaveBeenCalled();
        });
    });
});
