import { Test } from '@nestjs/testing';
import { SyncResultConsumer } from './sync-result.consumer';
import { ListingService } from '../listing/listing.service';
import { SyncGateway } from '../gateways/sync.gateway';
import { ModerationRepository } from '../moderation/moderation.repository';

describe('SyncResultConsumer', () => {
    let consumer: SyncResultConsumer;
    let listingServiceMock: jest.Mocked<Pick<ListingService, 'update'>>;
    let syncGatewayMock: any;
    let moderationRepoMock: any;

    beforeEach(async () => {
        listingServiceMock = { update: jest.fn() };
        syncGatewayMock = { emitSyncCompleted: jest.fn(), emitSyncFailed: jest.fn() };
        moderationRepoMock = { markResolvedByListingId: jest.fn() };

        const moduleRef = await Test.createTestingModule({
            providers: [
                SyncResultConsumer,
                { provide: ListingService, useValue: listingServiceMock },
                { provide: SyncGateway, useValue: syncGatewayMock },
                { provide: ModerationRepository, useValue: moderationRepoMock },
            ],
        }).compile();

        consumer = moduleRef.get(SyncResultConsumer);
    });

    it('success with externalId: calls ListingService.update with the same field set as before', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R1',
            listingId: 'L1',
            productId: 'P1',
            marketplaceId: 'M1',
            success: true,
            externalId: 'MLB1',
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L1',
            expect.objectContaining({
                externalId: 'MLB1',
                status: 'active',
                synchronized: true,
                errorMessage: null,
                publishingAt: null,
                'marketplaceData.syncIssue': null,
            }),
        );
        expect(moderationRepoMock.markResolvedByListingId).toHaveBeenCalledWith('L1');
        expect(syncGatewayMock.emitSyncCompleted).toHaveBeenCalledWith(
            expect.objectContaining({
                productId: 'P1',
                listingId: 'L1',
                externalId: 'MLB1',
                success: true,
            }),
        );
    });

    it('async-pending success: calls ListingService.update with pending_creation + syncMetadata', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R2',
            listingId: 'L2',
            productId: 'P2',
            marketplaceId: 'M2',
            success: true,
            metadata: { asyncPending: true, importToken: 'TOKEN1' },
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L2',
            expect.objectContaining({
                status: 'pending_creation',
                synchronized: false,
                errorMessage: null,
                publishingAt: null,
                'marketplaceData.syncMetadata': expect.objectContaining({
                    asyncPending: true,
                    importToken: 'TOKEN1',
                    reconcileAttempts: 0,
                }),
            }),
        );
    });

    it('DELETE com sucesso: marca listing removed, limpa externalId, NÃO resolve moderação', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R4',
            listingId: 'L4',
            productId: 'P4',
            marketplaceId: 'M4',
            action: 'DELETE',
            success: true,
            externalId: 'MLB4',
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L4',
            expect.objectContaining({
                status: 'removed',
                externalId: null,
                synchronized: false,
                publishingAt: null,
                'marketplaceData.syncIssue': null,
            }),
        );
        expect(moderationRepoMock.markResolvedByListingId).not.toHaveBeenCalled();
        expect(syncGatewayMock.emitSyncCompleted).toHaveBeenCalledWith(
            expect.objectContaining({ productId: 'P4', listingId: 'L4', success: true }),
        );
    });

    it('regressão: DELETE por moderação (moderationDelete:true) marca removed_by_moderation, não removed — elegível a reentrar num sync futuro (SyncQueueTargetResolverService/PublicationContextService filtram só status:removed)', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R7',
            listingId: 'L7',
            productId: 'P7',
            marketplaceId: 'M7',
            action: 'DELETE',
            moderationDelete: true,
            success: true,
            externalId: 'MLB7',
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L7',
            expect.objectContaining({ status: 'removed_by_moderation', externalId: null }),
        );
    });

    it('DELETE com falha: marca removal_failed, não mexe em moderação nem reativa o listing', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R5',
            listingId: 'L5',
            productId: 'P5',
            marketplaceId: 'M5',
            action: 'DELETE',
            success: false,
            errorMessage: 'ML rejected close',
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L5',
            expect.objectContaining({ status: 'removal_failed', errorMessage: 'ML rejected close', publishingAt: null }),
        );
        expect(moderationRepoMock.markResolvedByListingId).not.toHaveBeenCalled();
        expect(syncGatewayMock.emitSyncFailed).toHaveBeenCalledWith(
            expect.objectContaining({ productId: 'P5', listingId: 'L5', success: false }),
        );
    });

    it('CREATE com sucesso continua resolvendo moderação (comportamento existente preservado)', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R6',
            listingId: 'L6',
            productId: 'P6',
            marketplaceId: 'M6',
            action: 'CREATE',
            success: true,
            externalId: 'MLB6',
        } as any);

        expect(moderationRepoMock.markResolvedByListingId).toHaveBeenCalledWith('L6');
        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L6',
            expect.objectContaining({ status: 'active', externalId: 'MLB6' }),
        );
    });

    it('failure: calls ListingService.update with status error and the error message', async () => {
        listingServiceMock.update.mockResolvedValue({} as any);

        await consumer.handle({
            syncRequestId: 'R3',
            listingId: 'L3',
            productId: 'P3',
            marketplaceId: 'M3',
            success: false,
            errorMessage: 'Falhou',
        } as any);

        expect(listingServiceMock.update).toHaveBeenCalledWith(
            'L3',
            expect.objectContaining({
                status: 'error',
                errorMessage: 'Falhou',
                synchronized: false,
                publishingAt: null,
            }),
        );
        expect(syncGatewayMock.emitSyncFailed).toHaveBeenCalledWith(
            expect.objectContaining({
                productId: 'P3',
                listingId: 'L3',
                errorMessage: 'Falhou',
                success: false,
            }),
        );
    });
});
