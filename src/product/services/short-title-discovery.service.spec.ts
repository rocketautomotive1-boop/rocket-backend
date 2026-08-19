import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ShortTitleDiscoveryService } from './short-title-discovery.service';
import { ProductShortTitleModel } from '../schemas/product-short-title.schema';
import { ProductModel } from '../schemas/product.schema';

describe('ShortTitleDiscoveryService', () => {
    let service: ShortTitleDiscoveryService;
    let titleModel: { aggregate: jest.Mock };
    let productModel: { findById: jest.Mock; updateOne: jest.Mock };

    const productId = new Types.ObjectId().toHexString();
    const shortTitleId = new Types.ObjectId();

    beforeEach(async () => {
        titleModel = { aggregate: jest.fn() };
        productModel = {
            findById: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ titleId: undefined }),
            }),
            updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
        };

        const module = await Test.createTestingModule({
            providers: [
                ShortTitleDiscoveryService,
                { provide: getModelToken(ProductShortTitleModel.name), useValue: titleModel },
                { provide: getModelToken(ProductModel.name), useValue: productModel },
            ],
        }).compile();

        service = module.get(ShortTitleDiscoveryService);
    });

    afterEach(() => jest.clearAllMocks());

    function mockAggregate(hits: Array<{ _id: Types.ObjectId; text: string; synonyms: string[]; score: number }>) {
        titleModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue(hits) });
    }

    it('não faz nada para productId inválido', async () => {
        await service.resolveForProduct('not-an-id', 'Kit Pastilha de Freio');
        expect(productModel.findById).not.toHaveBeenCalled();
    });

    it('não faz nada para título vazio', async () => {
        await service.resolveForProduct(productId, '   ');
        expect(productModel.findById).not.toHaveBeenCalled();
    });

    it('nunca sobrescreve titleId já existente', async () => {
        productModel.findById.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue({ titleId: new Types.ObjectId() }),
        });

        await service.resolveForProduct(productId, 'Kit Pastilha de Freio');

        expect(titleModel.aggregate).not.toHaveBeenCalled();
        expect(productModel.updateOne).not.toHaveBeenCalled();
    });

    it('aplica titleId quando o top score domina claramente o segundo colocado', async () => {
        mockAggregate([
            { _id: shortTitleId, text: 'Kit Pastilha de Freio', synonyms: [], score: 5 },
            { _id: new Types.ObjectId(), text: 'Kit Pastilha de Embreagem', synonyms: [], score: 2 },
        ]);

        await service.resolveForProduct(productId, 'Kit Pastilha Freio Dianteiro Civic 2016-2021');

        expect(productModel.updateOne).toHaveBeenCalledWith(
            { _id: productId, titleId: { $exists: false } },
            {
                $set: {
                    titleId: shortTitleId,
                    titleText: 'Kit Pastilha de Freio',
                    titleSynonyms: [],
                },
            },
        );
    });

    it('não aplica quando os dois melhores resultados estão empatados/próximos', async () => {
        mockAggregate([
            { _id: shortTitleId, text: 'Kit Pastilha de Freio', synonyms: [], score: 3 },
            { _id: new Types.ObjectId(), text: 'Kit Pastilha de Embreagem', synonyms: [], score: 2.9 },
        ]);

        await service.resolveForProduct(productId, 'Kit Pastilha ambígua');

        expect(productModel.updateOne).not.toHaveBeenCalled();
    });

    it('não aplica quando não há nenhum resultado', async () => {
        mockAggregate([]);

        await service.resolveForProduct(productId, 'Peça nunca vista');

        expect(productModel.updateOne).not.toHaveBeenCalled();
    });

    it('não aplica quando o único resultado tem score muito baixo', async () => {
        mockAggregate([{ _id: shortTitleId, text: 'Parafuso', synonyms: [], score: 0.3 }]);

        await service.resolveForProduct(productId, 'Algo vagamente parecido');

        expect(productModel.updateOne).not.toHaveBeenCalled();
    });

    it('engole erros do Atlas Search sem propagar exceção', async () => {
        titleModel.aggregate.mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('index not found')) });

        await expect(service.resolveForProduct(productId, 'Kit Pastilha de Freio')).resolves.toBeUndefined();
        expect(productModel.updateOne).not.toHaveBeenCalled();
    });
});
