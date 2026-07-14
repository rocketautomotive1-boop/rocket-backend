import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { DisplayNameSynonymCandidateService } from './display-name-synonym-candidate.service';
import { CategoryHintModel } from '../schemas/category-hint.schema';
import { DisplayNameSynonymCandidateModel } from '../schemas/display-name-synonym-candidate.schema';
import { DisplayNameSynonymModel } from '../schemas/display-name-synonym.schema';

describe('DisplayNameSynonymCandidateService', () => {
    let service: DisplayNameSynonymCandidateService;
    let categoryHintModel: { find: jest.Mock };
    let candidateModel: { find: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock; findById: jest.Mock };
    let synonymModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };

    beforeEach(async () => {
        categoryHintModel = { find: jest.fn() };
        candidateModel = {
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            findById: jest.fn(),
        };
        synonymModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };

        const module = await Test.createTestingModule({
            providers: [
                DisplayNameSynonymCandidateService,
                { provide: getModelToken(CategoryHintModel.name), useValue: categoryHintModel },
                { provide: getModelToken(DisplayNameSynonymCandidateModel.name), useValue: candidateModel },
                { provide: getModelToken(DisplayNameSynonymModel.name), useValue: synonymModel },
            ],
        }).compile();

        service = module.get(DisplayNameSynonymCandidateService);
    });

    afterEach(() => jest.clearAllMocks());

    describe('checkAndEnqueue', () => {
        it('não enfileira quando occurrences < 2', async () => {
            await service.checkAndEnqueue('painel de porta', new Types.ObjectId(), 1);
            expect(categoryHintModel.find).not.toHaveBeenCalled();
        });

        it('não enfileira quando termo é vazio', async () => {
            await service.checkAndEnqueue('', new Types.ObjectId(), 5);
            expect(categoryHintModel.find).not.toHaveBeenCalled();
        });

        it('não enfileira quando há só um displayName na categoria', async () => {
            categoryHintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([{ displayNameNormalized: 'forro de porta', count: 5 }]),
            });

            await service.checkAndEnqueue('forro de porta', new Types.ObjectId(), 5);
            expect(candidateModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('não enfileira quando o termo já é o de maior count (é o canônico)', async () => {
            categoryHintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    { displayNameNormalized: 'forro de porta', count: 40 },
                    { displayNameNormalized: 'painel de porta', count: 2 },
                ]),
            });

            await service.checkAndEnqueue('forro de porta', new Types.ObjectId(), 40);
            expect(candidateModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('não reabre um candidato já rejeitado', async () => {
            categoryHintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    { displayNameNormalized: 'forro de porta', count: 40 },
                    { displayNameNormalized: 'painel de porta', count: 2 },
                ]),
            });
            candidateModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ status: 'rejected' }),
            });

            await service.checkAndEnqueue('painel de porta', new Types.ObjectId(), 2);
            expect(candidateModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('enfileira candidato com o displayName de maior count como canônico', async () => {
            const categoryId = new Types.ObjectId();
            categoryHintModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    { displayNameNormalized: 'forro de porta', count: 40 },
                    { displayNameNormalized: 'painel de porta', count: 2 },
                ]),
            });
            candidateModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });
            candidateModel.findOneAndUpdate.mockResolvedValue({});

            await service.checkAndEnqueue('painel de porta', categoryId, 2);

            expect(candidateModel.findOneAndUpdate).toHaveBeenCalledWith(
                { termNormalized: 'painel de porta', categoryId },
                { $set: { canonicalDisplayName: 'forro de porta', occurrences: 2, status: 'pending' } },
                { upsert: true },
            );
        });
    });

    describe('listPending', () => {
        it('mapeia os candidatos pendentes ordenados por occurrences', async () => {
            const categoryId = new Types.ObjectId();
            candidateModel.find.mockReturnValue({
                sort: jest.fn().mockReturnThis(),
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([
                    {
                        _id: 'c1',
                        termNormalized: 'painel de porta',
                        canonicalDisplayName: 'forro de porta',
                        categoryId,
                        occurrences: 5,
                    },
                ]),
            });

            const result = await service.listPending();
            expect(result).toEqual([
                {
                    id: 'c1',
                    termNormalized: 'painel de porta',
                    canonicalDisplayName: 'forro de porta',
                    categoryId: String(categoryId),
                    occurrences: 5,
                },
            ]);
        });
    });

    describe('approve', () => {
        it('lança NotFoundException quando candidato não existe', async () => {
            candidateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
            await expect(service.approve('missing-id')).rejects.toThrow(NotFoundException);
        });

        it('cria o sinônimo apontando pro canônico e marca approved', async () => {
            const categoryId = new Types.ObjectId();
            const candidateDoc: { reviewedAt?: Date; [key: string]: unknown } = {
                _id: 'c1',
                termNormalized: 'painel de porta',
                canonicalDisplayName: 'forro de porta',
                categoryId,
                status: 'pending',
                save: jest.fn().mockResolvedValue(undefined),
            };
            candidateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(candidateDoc) });
            synonymModel.findOneAndUpdate.mockResolvedValue({});

            await service.approve('c1');

            expect(synonymModel.findOneAndUpdate).toHaveBeenCalledWith(
                { termNormalized: 'painel de porta' },
                { $set: { canonicalDisplayName: 'forro de porta', categoryId } },
                { upsert: true },
            );
            expect(candidateDoc.status).toBe('approved');
            expect(candidateDoc.reviewedAt).toBeInstanceOf(Date);
            expect(candidateDoc.save).toHaveBeenCalled();
        });
    });

    describe('reject', () => {
        it('lança NotFoundException quando candidato não existe', async () => {
            candidateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
            await expect(service.reject('missing-id')).rejects.toThrow(NotFoundException);
        });

        it('marca status rejected sem criar sinônimo', async () => {
            const candidateDoc: { reviewedAt?: Date; [key: string]: unknown } = {
                _id: 'c1',
                termNormalized: 'painel de porta',
                categoryId: new Types.ObjectId(),
                status: 'pending',
                save: jest.fn().mockResolvedValue(undefined),
            };
            candidateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(candidateDoc) });

            await service.reject('c1');

            expect(candidateDoc.status).toBe('rejected');
            expect(candidateDoc.save).toHaveBeenCalled();
            expect(synonymModel.findOneAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('resolveCanonical', () => {
        it('retorna o próprio termo quando não há sinônimo', async () => {
            synonymModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(null),
            });

            const result = await service.resolveCanonical('painel de porta');
            expect(result).toBe('painel de porta');
        });

        it('retorna o canônico quando existe sinônimo', async () => {
            synonymModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue({ canonicalDisplayName: 'forro de porta' }),
            });

            const result = await service.resolveCanonical('painel de porta');
            expect(result).toBe('forro de porta');
        });
    });
});
