import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductShortTitleService } from './product-short-title.service';
import { ProductShortTitleModel } from '../schemas/product-short-title.schema';
import { ProductModel } from '../schemas/product.schema';

describe('ProductShortTitleService', () => {
    let service: ProductShortTitleService;
    let titleModel: {
        findOne: jest.Mock;
        findById: jest.Mock;
        find: jest.Mock;
        create: jest.Mock;
        findByIdAndUpdate: jest.Mock;
        deleteOne: jest.Mock;
    };
    let productModel: { updateMany: jest.Mock };

    beforeEach(async () => {
        titleModel = {
            findOne: jest.fn(),
            findById: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            findByIdAndUpdate: jest.fn(),
            deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
        };
        productModel = { updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };

        const module = await Test.createTestingModule({
            providers: [
                ProductShortTitleService,
                { provide: getModelToken(ProductShortTitleModel.name), useValue: titleModel },
                { provide: getModelToken(ProductModel.name), useValue: productModel },
            ],
        }).compile();

        service = module.get(ProductShortTitleService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('resolve', () => {
        it('retorna null para texto vazio', async () => {
            const result = await service.resolve('   ');
            expect(result).toBeNull();
            expect(titleModel.findOne).not.toHaveBeenCalled();
        });

        it('busca por textNormalized OU synonyms normalizado', async () => {
            titleModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            await service.resolve('  Parafuso  ');

            expect(titleModel.findOne).toHaveBeenCalledWith({
                $or: [{ textNormalized: 'parafuso' }, { synonyms: 'parafuso' }],
            });
        });

        it('retorna o title encontrado (por sinônimo aponta pro canônico)', async () => {
            const doc = { _id: 't1', text: 'Parafuso', textNormalized: 'parafuso', synonyms: ['rosca'] };
            titleModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(doc),
            });

            const result = await service.resolve('Rosca');
            expect(result).toEqual(doc);
        });
    });

    describe('createOrGet', () => {
        it('retorna o existente sem criar quando já resolve por texto/sinônimo', async () => {
            const existing = { _id: 't1', text: 'Parafuso', textNormalized: 'parafuso', synonyms: [] };
            titleModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(existing),
            });

            const result = await service.createOrGet('Parafuso');

            expect(result).toEqual(existing);
            expect(titleModel.create).not.toHaveBeenCalled();
        });

        it('cria um novo title quando nada resolve', async () => {
            titleModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });
            const created = { _id: 't2', text: 'Porca', textNormalized: 'porca', synonyms: [] };
            titleModel.create.mockResolvedValue(created);

            const result = await service.createOrGet('Porca');

            expect(titleModel.create).toHaveBeenCalledWith({
                text: 'Porca',
                textNormalized: 'porca',
                synonyms: [],
                usageCount: 0,
            });
            expect(result).toEqual(created);
        });
    });

    describe('addSynonym', () => {
        it('lança NotFoundException quando o title não existe', async () => {
            titleModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
            await expect(service.addSynonym('missing', 'rosca')).rejects.toThrow(NotFoundException);
        });

        it('adiciona o sinônimo normalizado, dedupa, e propaga (fan-out) para produtos vinculados', async () => {
            const titleId = new Types.ObjectId().toString();
            titleModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['rosca'],
                }),
            });
            titleModel.findByIdAndUpdate.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['rosca', 'perno'],
                }),
            });

            const result = await service.addSynonym(titleId, '  Perno  ');

            expect(titleModel.findByIdAndUpdate).toHaveBeenCalledWith(
                titleId,
                { $addToSet: { synonyms: 'perno' } },
                { new: true },
            );
            expect(productModel.updateMany).toHaveBeenCalledWith(
                { titleId: expect.any(Types.ObjectId) },
                { $set: { titleSynonyms: ['rosca', 'perno'] } },
            );
            expect(result?.synonyms).toEqual(['rosca', 'perno']);
        });

        it('não duplica sinônimo já existente (dedupe no-op) mas ainda propaga', async () => {
            const titleId = new Types.ObjectId().toString();
            titleModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['rosca'],
                }),
            });
            titleModel.findByIdAndUpdate.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['rosca'],
                }),
            });

            await service.addSynonym(titleId, 'Rosca');

            expect(titleModel.findByIdAndUpdate).toHaveBeenCalledWith(
                titleId,
                { $addToSet: { synonyms: 'rosca' } },
                { new: true },
            );
        });
    });

    describe('removeSynonym', () => {
        it('lança NotFoundException quando o title não existe', async () => {
            titleModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
            await expect(service.removeSynonym('missing', 'rosca')).rejects.toThrow(NotFoundException);
        });

        it('remove o sinônimo normalizado e propaga (fan-out) para produtos vinculados', async () => {
            const titleId = new Types.ObjectId().toString();
            titleModel.findById.mockReturnValue({
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['rosca', 'perno'],
                }),
            });
            titleModel.findByIdAndUpdate.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({
                    _id: titleId,
                    text: 'Parafuso',
                    textNormalized: 'parafuso',
                    synonyms: ['perno'],
                }),
            });

            const result = await service.removeSynonym(titleId, '  Rosca  ');

            expect(titleModel.findByIdAndUpdate).toHaveBeenCalledWith(
                titleId,
                { $pull: { synonyms: 'rosca' } },
                { new: true },
            );
            expect(productModel.updateMany).toHaveBeenCalledWith(
                { titleId: expect.any(Types.ObjectId) },
                { $set: { titleSynonyms: ['perno'] } },
            );
            expect(result?.synonyms).toEqual(['perno']);
        });
    });

    describe('merge', () => {
        it('lança NotFoundException quando source não existe', async () => {
            const targetId = new Types.ObjectId().toString();
            titleModel.findById.mockImplementation((id: string) =>
                id === targetId
                    ? { exec: jest.fn().mockResolvedValue({ _id: targetId, text: 'Filtro de Óleo', synonyms: [], usageCount: 8 }) }
                    : { exec: jest.fn().mockResolvedValue(null) },
            );
            await expect(service.merge('missing', targetId)).rejects.toThrow(NotFoundException);
        });

        it('lança NotFoundException quando target não existe', async () => {
            const sourceId = new Types.ObjectId().toString();
            titleModel.findById.mockImplementation((id: string) =>
                id === sourceId
                    ? { exec: jest.fn().mockResolvedValue({ _id: sourceId, text: 'Filtro de Òleo', synonyms: [], usageCount: 2 }) }
                    : { exec: jest.fn().mockResolvedValue(null) },
            );
            await expect(service.merge(sourceId, 'missing')).rejects.toThrow(NotFoundException);
        });

        it('rejeita merge de um título nele mesmo', async () => {
            const id = new Types.ObjectId().toString();
            await expect(service.merge(id, id)).rejects.toThrow();
            expect(titleModel.findById).not.toHaveBeenCalled();
        });

        it('move produtos do source pro target, soma usageCount, herda o texto do source como sinônimo, e apaga o source', async () => {
            const sourceId = new Types.ObjectId().toString();
            const targetId = new Types.ObjectId().toString();
            const source = { _id: sourceId, text: 'Filtro de Òleo', textNormalized: 'filtro de òleo', synonyms: ['oleo velho'], usageCount: 2 };
            const target = { _id: targetId, text: 'Filtro de Óleo', textNormalized: 'filtro de óleo', synonyms: ['oleo'], usageCount: 8 };

            titleModel.findById.mockImplementation((id: string) => {
                if (id === sourceId) return { exec: jest.fn().mockResolvedValue(source) };
                if (id === targetId) return { exec: jest.fn().mockResolvedValue(target) };
                return { exec: jest.fn().mockResolvedValue(null) };
            });
            titleModel.findByIdAndUpdate.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({
                    ...target,
                    usageCount: 10,
                    synonyms: ['oleo', 'oleo velho', 'filtro de òleo'],
                }),
            });

            const result = await service.merge(sourceId, targetId);

            // produtos apontando pro source passam a apontar pro target (titleId + denormalizados)
            expect(productModel.updateMany).toHaveBeenCalledWith(
                { titleId: expect.any(Types.ObjectId) },
                {
                    $set: {
                        titleId: expect.any(Types.ObjectId),
                        titleText: target.text,
                        titleSynonyms: ['oleo', 'oleo velho', 'filtro de òleo'],
                    },
                },
            );

            // target ganha usageCount somado + sinônimos do source + o próprio texto do source como sinônimo
            expect(titleModel.findByIdAndUpdate).toHaveBeenCalledWith(
                targetId,
                {
                    $inc: { usageCount: source.usageCount },
                    $addToSet: { synonyms: { $each: ['oleo velho', 'filtro de òleo'] } },
                },
                { new: true },
            );

            expect(titleModel.deleteOne).toHaveBeenCalledWith({ _id: sourceId });
            expect(result?.usageCount).toBe(10);
        });
    });

    describe('autocomplete', () => {
        it('retorna vazio para query vazia', async () => {
            const result = await service.autocomplete('');
            expect(result).toEqual([]);
            expect(titleModel.find).not.toHaveBeenCalled();
        });

        it('busca por regex em text/synonyms ordenado por usageCount desc', async () => {
            titleModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([{ _id: 't1', text: 'Parafuso', usageCount: 10 }]),
            });

            const result = await service.autocomplete('paraf');

            expect(titleModel.find).toHaveBeenCalledWith({
                $or: [
                    { textNormalized: { $regex: 'paraf', $options: 'i' } },
                    { synonyms: { $regex: 'paraf', $options: 'i' } },
                ],
            });
            expect(result).toEqual([{ _id: 't1', text: 'Parafuso', usageCount: 10 }]);
        });
    });
});
