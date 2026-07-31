import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TitleCategoryHintService } from './title-category-hint.service';
import { TitleCategoryHintModel } from '../schemas/title-category-hint.schema';
import { CategoryModel } from '../schemas/category.schema';

describe('TitleCategoryHintService', () => {
    let service: TitleCategoryHintService;
    let hintModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
    let categoryModel: { findById: jest.Mock };

    beforeEach(async () => {
        hintModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
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
        it('retorna null quando titleId é inválido', async () => {
            const result = await service.suggestCategory('not-an-object-id');
            expect(result).toBeNull();
            expect(hintModel.findOne).not.toHaveBeenCalled();
        });

        it('retorna null quando não há hint para o titleId', async () => {
            hintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });

        it('retorna o hint de maior count, populando o nome da categoria', async () => {
            const titleId = new Types.ObjectId().toString();
            const categoryId = new Types.ObjectId();
            hintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ categoryId, count: 7 }),
            });
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ name: 'Parafusos' }),
            });

            const result = await service.suggestCategory(titleId);

            expect(hintModel.findOne).toHaveBeenCalledWith({ titleId: new Types.ObjectId(titleId) });
            expect(result).toEqual({ categoryId: String(categoryId), categoryName: 'Parafusos', count: 7 });
        });

        it('retorna null quando a categoria referenciada pelo hint não existe mais', async () => {
            hintModel.findOne.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ categoryId: new Types.ObjectId(), count: 3 }),
            });
            categoryModel.findById.mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.suggestCategory(new Types.ObjectId().toString());
            expect(result).toBeNull();
        });
    });
});
