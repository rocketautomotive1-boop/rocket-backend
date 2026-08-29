import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { ShortTitleDiscoveryService, buildPositionalBoostClauses } from './short-title-discovery.service';
import { ProductShortTitleModel } from '../schemas/product-short-title.schema';
import { ProductModel } from '../schemas/product.schema';
import { PRODUCT_SECTION_EVENTS, ProductTitleIdResolvedEvent } from '../events/product-section-saved.event';

describe('buildPositionalBoostClauses', () => {
    it('dá boost decrescente às primeiras palavras do título, ignorando stopwords', () => {
        const clauses = buildPositionalBoostClauses('Airbag de Volante Toro 2016-2021');

        expect(clauses[0]).toMatchObject({ text: { query: 'Airbag', score: { boost: { value: 3 } } } });
        expect(clauses[1]).toMatchObject({ text: { query: 'Volante', score: { boost: { value: 2 } } } });
    });

    it('não gera clause para título vazio', () => {
        expect(buildPositionalBoostClauses('   ')).toEqual([]);
    });
});

describe('ShortTitleDiscoveryService', () => {
    let service: ShortTitleDiscoveryService;
    let titleModel: { aggregate: jest.Mock };
    let productModel: { findById: jest.Mock; updateOne: jest.Mock };
    let eventEmitter: { emit: jest.Mock };

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
        eventEmitter = { emit: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                ShortTitleDiscoveryService,
                { provide: getModelToken(ProductShortTitleModel.name), useValue: titleModel },
                { provide: getModelToken(ProductModel.name), useValue: productModel },
                { provide: EventEmitter2, useValue: eventEmitter },
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

    it('emite TITLE_ID_RESOLVED quando titleId é aplicado com sucesso', async () => {
        mockAggregate([
            { _id: shortTitleId, text: 'Kit Pastilha de Freio', synonyms: [], score: 5 },
            { _id: new Types.ObjectId(), text: 'Kit Pastilha de Embreagem', synonyms: [], score: 2 },
        ]);

        await service.resolveForProduct(productId, 'Kit Pastilha Freio Dianteiro Civic 2016-2021');

        expect(eventEmitter.emit).toHaveBeenCalledWith(
            PRODUCT_SECTION_EVENTS.TITLE_ID_RESOLVED,
            expect.any(ProductTitleIdResolvedEvent),
        );
        const event = eventEmitter.emit.mock.calls[0][1] as ProductTitleIdResolvedEvent;
        expect(event.productId).toBe(productId);
        expect(event.titleId).toBe(shortTitleId.toHexString());
    });

    it('não emite TITLE_ID_RESOLVED quando titleId já existia', async () => {
        productModel.findById.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue({ titleId: new Types.ObjectId() }),
        });

        await service.resolveForProduct(productId, 'Kit Pastilha de Freio');

        expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('não emite TITLE_ID_RESOLVED quando nenhum match é aplicado', async () => {
        mockAggregate([]);

        await service.resolveForProduct(productId, 'Peça nunca vista');

        expect(eventEmitter.emit).not.toHaveBeenCalled();
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
