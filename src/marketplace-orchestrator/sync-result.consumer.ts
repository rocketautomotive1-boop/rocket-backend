import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ListingService } from '../listing/listing.service';
import { SyncGateway } from '../gateways/sync.gateway';
import { ModerationRepository } from '../moderation/moderation.repository';
import { ProductDeletionService } from '../product-deletion/product-deletion.service';

interface SyncResultMessage {
    syncRequestId: string;
    listingId: string;
    productId: string;
    marketplaceId: string;
    marketplaceTag?: string;
    action?: 'CREATE' | 'UPDATE' | 'DELETE';
    moderationDelete?: boolean;
    success: boolean;
    externalId?: string;
    errorMessage?: string;
    errorClassifier?: string;
    processedAt?: string;
    metadata?: any;
}

@Injectable()
export class SyncResultConsumer {
    private readonly logger = new Logger(SyncResultConsumer.name);

    constructor(
        private readonly listingService: ListingService,
        private readonly syncGateway: SyncGateway,
        private readonly moderationRepo: ModerationRepository,
        @Inject(forwardRef(() => ProductDeletionService))
        private readonly productDeletion: ProductDeletionService,
    ) {}

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
        queueOptions: { durable: true },
    })
    async handle(msg: SyncResultMessage): Promise<void> {
        this.logger.log(
            `Sync result received: listing=${msg.listingId} success=${msg.success} externalId=${msg.externalId}`,
        );

        const marketplaceTag = msg.marketplaceTag ?? String(msg.marketplaceId);

        if (msg.action === 'DELETE' && msg.success) {
            // Exclusão manual (usuário) nunca reentra sozinha num sync futuro — 'removed' é
            // filtrado tanto em SyncQueueTargetResolverService quanto em
            // PublicationContextService. Exclusão por moderação usa 'removed_by_moderation',
            // que os dois resolvers tratam como elegível — assim que o produto ficar ready de
            // novo (categoria corrigida), o CREATE seguinte recria o anúncio automaticamente.
            const set: Record<string, any> = {
                status: msg.moderationDelete ? 'removed_by_moderation' : 'removed',
                externalId: null,
                synchronized: false,
                errorMessage: null,
                lastSyncAt: new Date(),
                publishingAt: null,
                'marketplaceData.syncIssue': null,
                'marketplaceData.removal_attempts': null,
                'marketplaceData.removal_last_attempt_at': null,
            };
            await this.listingService.update(msg.listingId, set);

            this.syncGateway.emitSyncCompleted({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                externalId: '',
                marketplaceTag,
                success: true,
            });

            // No-op se o produto não estiver em exclusão em cascata (ver ProductDeletionService).
            await this.productDeletion.onListingRemovalResult(String(msg.productId), String(msg.listingId), true);
            return;
        }

        if (msg.action === 'DELETE' && !msg.success) {
            await this.listingService.update(msg.listingId, {
                status: 'removal_failed',
                errorMessage: msg.errorMessage ?? 'DELETE failed',
                lastSyncAt: new Date(),
                publishingAt: null,
            });
            this.syncGateway.emitSyncFailed({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                errorMessage: msg.errorMessage ?? 'DELETE failed',
                errorClassifier: msg.errorClassifier,
                marketplaceTag,
                success: false,
            });

            await this.productDeletion.onListingRemovalResult(String(msg.productId), String(msg.listingId), false);
            return;
        }

        if (msg.success && msg.externalId) {
            const set: Record<string, any> = {
                externalId: msg.externalId,
                status: 'active',
                synchronized: true,
                errorMessage: null,
                lastSyncAt: new Date(),
                publishingAt: null,
                'marketplaceData.syncIssue': null,
            };
            // storeId já é gravado como snapshot na criação do listing (ver
            // ProductTitleService.updateTitles) — não é re-carimbado aqui.
            await this.listingService.update(msg.listingId, set);

            // A successful (re)publish clears any open moderation on this listing — the listing was
            // recreated/fixed. The reconciler would catch this too, but closing here is immediate.
            await this.moderationRepo.markResolvedByListingId(String(msg.listingId));

            this.syncGateway.emitSyncCompleted({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                externalId: msg.externalId,
                marketplaceTag,
                success: true,
            });
        } else if (msg.success && msg.metadata?.asyncPending && msg.metadata?.importToken) {
            // OLX (e outros fluxos assíncronos): import aceito, list_id ainda não emitido.
            // O reconciler (ex.: OLXReconciliationService) consulta o importToken depois.
            const pendingSet: Record<string, any> = {
                status: 'pending_creation',
                synchronized: false,
                errorMessage: null,
                lastSyncAt: new Date(),
                publishingAt: null,
                'marketplaceData.syncMetadata': {
                    asyncPending: true,
                    importToken: msg.metadata.importToken,
                    reconcileAttempts: 0,
                    nextCheckAt: new Date().toISOString(),
                },
            };
            await this.listingService.update(msg.listingId, pendingSet);
        } else if (!msg.success) {
            await this.listingService.update(msg.listingId, {
                status: 'error',
                errorMessage: msg.errorMessage ?? 'Sync failed',
                synchronized: false,
                lastSyncAt: new Date(),
                publishingAt: null,
            });

            this.syncGateway.emitSyncFailed({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                errorMessage: msg.errorMessage ?? 'Sync failed',
                errorClassifier: msg.errorClassifier,
                marketplaceTag,
                success: false,
            });
        }
    }
}
