import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';

@Injectable()
export class OLXReconciliationService {
    private readonly logger = new Logger(OLXReconciliationService.name);
    private readonly baseUrl = 'https://apps.olx.com.br';
    private readonly maxAttempts = 20;
    private readonly batchSize = 50;

    constructor(
        @InjectModel(ListingModel.name)
        private readonly listingModel: Model<ListingDocument>,
        private readonly authService: MarketplaceAuthService,
        private readonly amqpConnection: AmqpConnection,
    ) { }

    // Every 30 seconds: reconcile async OLX imports waiting for externalId.
    @Cron('*/30 * * * * *')
    async reconcilePendingImports() {
        const now = new Date();
        const pendingListings = await this.listingModel.find({
            status: 'pending_creation',
            'marketplaceData.syncMetadata.asyncPending': true,
            'marketplaceData.syncMetadata.importToken': { $exists: true, $type: 'string' },
            $or: [
                { 'marketplaceData.syncMetadata.nextCheckAt': { $exists: false } },
                { 'marketplaceData.syncMetadata.nextCheckAt': null },
                { 'marketplaceData.syncMetadata.nextCheckAt': { $lte: now.toISOString() } },
            ],
        }).limit(this.batchSize).exec();

        if (!pendingListings.length) return;

        this.logger.log(`[OLX] Reconciling ${pendingListings.length} async pending listing(s).`);

        for (const listing of pendingListings) {
            await this.reconcileListing(listing);
        }
    }

    private async reconcileListing(listing: ListingDocument): Promise<void> {
        const syncMeta = (listing.marketplaceData?.syncMetadata || {}) as any;
        const importToken = syncMeta.importToken as string;
        const attempts = Number(syncMeta.reconcileAttempts || 0);

        if (!importToken) return;

        if (attempts >= this.maxAttempts) {
            await this.publishFailureResult(
                listing,
                syncMeta,
                `Timeout de reconciliação OLX após ${attempts} tentativas (importToken=${importToken}).`,
            );
            return;
        }

        try {
            const resolvedToken = await this.authService.ensureValidToken(String(listing.marketplaceId));
            const accessToken = resolvedToken?.accessToken;
            if (!accessToken) {
                throw new Error('Access token ausente para reconciliação OLX.');
            }

            const response = await axios.post(
                `${this.baseUrl}/autoupload/import/${importToken}`,
                { access_token: accessToken },
                { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
            );

            const data = response.data;
            const ads = this.normalizeAds(data?.ads);
            const accepted = ads.find(ad => ad.status === 'accepted');
            if (accepted?.list_id) {
                await this.publishSuccessResult(listing, syncMeta, String(accepted.list_id), importToken);
                return;
            }

            const refused = ads.find(ad => ad.status === 'refused' || ad.status === 'error');
            const stillPending = ads.some(ad => ad.status === 'pending' || ad.status === 'queued');
            if (refused || (data?.autoupload_status === 'done' && !stillPending)) {
                const refusalDetails = refused ? JSON.stringify(refused) : JSON.stringify(data);
                await this.publishFailureResult(
                    listing,
                    syncMeta,
                    `Importação OLX concluída sem aceite do anúncio. Detalhes: ${refusalDetails}`,
                );
                return;
            }

            await this.scheduleNextCheck(listing, attempts + 1);
        } catch (error) {
            this.logger.warn(`[OLX] Reconcile failed for listing ${listing._id}: ${(error as any).message}`);
            await this.scheduleNextCheck(listing, attempts + 1);
        }
    }

    private async scheduleNextCheck(listing: ListingDocument, nextAttempt: number): Promise<void> {
        const backoffMs = this.calculateBackoffMs(nextAttempt);
        const nextCheckAt = new Date(Date.now() + backoffMs).toISOString();

        await this.listingModel.updateOne(
            { _id: listing._id },
            {
                $set: {
                    'marketplaceData.syncMetadata.reconcileAttempts': nextAttempt,
                    'marketplaceData.syncMetadata.lastCheckAt': new Date().toISOString(),
                    'marketplaceData.syncMetadata.nextCheckAt': nextCheckAt,
                },
            },
        ).exec();
    }

    private async publishSuccessResult(
        listing: ListingDocument,
        syncMeta: any,
        externalId: string,
        importToken: string,
    ): Promise<void> {
        const result: MarketplaceSyncResult = {
            jobId: `olx-reconcile-${listing._id}-${Date.now()}`,
            attemptId: syncMeta?.attemptId,
            marketplaceId: String(listing.marketplaceId),
            listingId: String(listing._id),
            success: true,
            action: 'CREATE',
            externalId,
            timestamp: new Date(),
            metadata: {
                reconciledAsync: true,
                importToken,
                asyncPending: false, // Clear the pending flag
            },
        };

        await this.amqpConnection.publish('rocket.marketplace.results', 'result.olx', result);
        this.logger.log(`[OLX] Reconciliation success for listing ${listing._id}: externalId=${externalId}`);
    }

    private async publishFailureResult(
        listing: ListingDocument,
        syncMeta: any,
        errorMessage: string,
    ): Promise<void> {
        const result: MarketplaceSyncResult = {
            jobId: `olx-reconcile-${listing._id}-${Date.now()}`,
            attemptId: syncMeta?.attemptId,
            marketplaceId: String(listing.marketplaceId),
            listingId: String(listing._id),
            success: false,
            action: 'CREATE',
            errorMessage,
            timestamp: new Date(),
            metadata: {
                reconciledAsync: true,
                importToken: syncMeta?.importToken,
                asyncPending: false, // Clear the pending flag on final failure
            },
        };

        await this.amqpConnection.publish('rocket.marketplace.results', 'result.olx', result);
        this.logger.warn(`[OLX] Reconciliation failure for listing ${listing._id}: ${errorMessage}`);
    }

    private calculateBackoffMs(attempt: number): number {
        const baseMs = 30_000; // 30s
        const maxMs = 15 * 60_000; // 15min
        return Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), maxMs);
    }

    private normalizeAds(rawAds: any): any[] {
        if (!rawAds) return [];
        if (Array.isArray(rawAds)) return rawAds;

        if (typeof rawAds === 'object') {
            return Object.entries(rawAds).map(([key, value]) => {
                if (value && typeof value === 'object') {
                    return { list_id: (value as any).list_id ?? key, ...(value as any) };
                }
                return { list_id: key, status: String(value) };
            });
        }

        return [];
    }
}
