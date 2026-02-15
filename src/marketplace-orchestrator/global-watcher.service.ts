import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';
import { WatcherToken, WatcherTokenDocument } from './schemas/watcher-token.schema';
import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';

@Injectable()
export class GlobalWatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(GlobalWatcherService.name);
    private productStream: mongo.ChangeStream;
    private listingStream: mongo.ChangeStream;

    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
        @InjectModel(WatcherToken.name) private watcherTokenModel: Model<WatcherTokenDocument>,
        private readonly orchestrator: MarketplaceOrchestratorService,
    ) { }

    async onModuleInit() {
        this.logger.log('Initializing GlobalWatcherService...');
        await this.startProductWatcher();
        await this.startListingWatcher();
    }

    async onModuleDestroy() {
        if (this.productStream) await this.productStream.close();
        if (this.listingStream) await this.listingStream.close();
    }

    private async getResumeToken(watcherName: string): Promise<any> {
        const tokenDoc = await this.watcherTokenModel.findOne({ watcherName }).exec();
        return tokenDoc?.resumeToken || null;
    }

    private async saveResumeToken(watcherName: string, token: any) {
        if (!token) return;
        await this.watcherTokenModel.updateOne(
            { watcherName },
            { resumeToken: token },
            { upsert: true }
        ).exec();
    }

    private debounceMap = new Map<string, any>();
    private readonly DEBOUNCE_MS = 2000;

    private debounce(key: string, callback: () => Promise<void>) {
        if (this.debounceMap.has(key)) {
            clearTimeout(this.debounceMap.get(key));
        }

        const timeout = setTimeout(async () => {
            this.debounceMap.delete(key);
            try {
                await callback();
            } catch (err) {
                this.logger.error(`Error in debounced sync for ${key}: ${err.message}`, err.stack);
            }
        }, this.DEBOUNCE_MS);

        this.debounceMap.set(key, timeout);
    }

    // --- Product Watcher ---

    private async startProductWatcher() {
        const resumeToken = await this.getResumeToken('products-watcher');
        const options: any = { fullDocument: 'updateLookup' };
        if (resumeToken) {
            options.resumeAfter = resumeToken;
            this.logger.log(`Resuming products stream from token...`);
        }

        const pipeline = [
            {
                $match: {
                    $or: [
                        { operationType: 'update' },
                        { operationType: 'replace' },
                        { operationType: 'insert' }
                    ]
                }
            }
        ];

        try {
            this.productStream = this.productModel.watch(pipeline, options);

            this.productStream.on('change', async (change: any) => {
                this.logger.log(`[STREAM DEBUG] Raw Event: ${change.operationType} on ${change.documentKey?._id}`);
                // Use JSON.stringify for updateDescription only if it exists/is simple, cautious to avoid circular (though simple here)
                if (change.updateDescription) {
                    this.logger.debug(`[STREAM DEBUG] Updated Fields: ${JSON.stringify(change.updateDescription.updatedFields)}`);
                }

                await this.handleProductChange(change);
                await this.saveResumeToken('products-watcher', change._id);
            });

            this.productStream.on('error', async (err: any) => {
                this.logger.error(`Product Stream Error: ${err.message}`, err.stack);
                // Check for Oplog/Resume errors
                if (err.message && (
                    err.message.includes('Resume of change stream was not possible') ||
                    err.message.includes('resume point may no longer be in the oplog')
                )) {
                    this.logger.warn('Invalid resume token detected. Deleting token and restarting watcher...');
                    await this.watcherTokenModel.deleteOne({ watcherName: 'products-watcher' });
                    this.productStream.close().catch(() => { });
                    setTimeout(() => this.startProductWatcher(), 1000);
                }
            });

            this.logger.log('Product Watcher started successfully.');
        } catch (err) {
            this.logger.error(`Failed to start product watcher: ${err.message}`);
        }
    }

    private pendingSyncs = new Map<string, Set<string>>();

    private accumulateAndDebounce(productId: string, marketplaceId: string | 'ALL') {
        if (!this.pendingSyncs.has(productId)) {
            this.pendingSyncs.set(productId, new Set());
        }
        this.pendingSyncs.get(productId).add(marketplaceId);

        this.debounce(`product-sync-${productId}`, async () => {
            const targets = this.pendingSyncs.get(productId);
            if (!targets) return;

            // Clone and clear to handle next batch cleanly
            const targetsToProcess = new Set(targets);
            this.pendingSyncs.delete(productId);

            if (targetsToProcess.has('ALL')) {
                this.logger.log(`[Debounce] Triggering FULL SYNC for product ${productId} (accumulated generic/global changes).`);
                await this.orchestrator.syncProductToAllMarketplaces(productId);
            } else {
                this.logger.log(`[Debounce] Triggering PARTIAL SYNC for product ${productId} (marketplaces: ${Array.from(targetsToProcess).join(', ')}).`);
                for (const mpId of targetsToProcess) {
                    await this.orchestrator.syncProductToAllMarketplaces(productId, mpId);
                }
            }
        });
    }

    private async handleProductChange(change: any) {
        const productId = change.documentKey._id.toString();

        // [FIX] Handle 'replace' and 'insert' operations (e.g. from .save() or .create())
        if (change.operationType === 'replace' || change.operationType === 'insert') {
            this.debounce(`product-replace-${productId}`, async () => {
                this.logger.log(`Detected ${change.operationType.toUpperCase()} operation for product ${productId}. Triggering full sync.`);
                await this.orchestrator.syncProductToAllMarketplaces(productId);
            });
            return;
        }

        const updatedFields = change.updateDescription?.updatedFields || {};
        const fieldKeys = Object.keys(updatedFields);

        // Filter relevant fields for generic sync
        const genericSyncFields = [
            'price', 'stockQuantity', 'images', 'weight', 'dimensions',
            'partNumber', 'brand', 'active', 'category', 'status',
            'oemCodes', 'barcode', 'name', 'description', 'details'
        ];
        const shouldSyncGeneric = fieldKeys.some(key => {
            const rootKey = key.split('.')[0];
            return genericSyncFields.includes(rootKey);
        });

        if (shouldSyncGeneric) {
            this.logger.log(`Detected change in generic fields for product ${productId}. Queueing full sync.`);
            this.accumulateAndDebounce(productId, 'ALL');
            return; // 'ALL' overrides everything, so we can return early or just let it accumulate
        }

        // Filter for Attribute changes
        const attributeChanges = fieldKeys.filter(key => key.startsWith('attributes'));
        if (attributeChanges.length > 0) {
            const fullDoc = change.fullDocument;
            let globalAttributeChange = false;

            if (fullDoc && fullDoc.attributes) {
                for (const key of attributeChanges) {
                    if (key === 'attributes') {
                        // Full array replacement
                        this.accumulateAndDebounce(productId, 'ALL');
                        return;
                    }

                    const match = key.match(/attributes\.(\d+)/);
                    if (match) {
                        const index = parseInt(match[1], 10);
                        const attribute = fullDoc.attributes[index];
                        if (attribute && attribute.marketplaceId) {
                            this.accumulateAndDebounce(productId, attribute.marketplaceId.toString());
                        } else {
                            // Attribute without marketplaceId affects all or logic is simpler to just sync all
                            globalAttributeChange = true;
                        }
                    } else {
                        globalAttributeChange = true;
                    }
                }
            }

            if (globalAttributeChange) {
                this.accumulateAndDebounce(productId, 'ALL');
            }
        }
    }


    // --- Listing Watcher ---

    private async startListingWatcher() {
        const resumeToken = await this.getResumeToken('listings-watcher');
        const options: any = { fullDocument: 'updateLookup' };
        if (resumeToken) {
            options.resumeAfter = resumeToken;
            this.logger.log(`Resuming listings stream from token...`);
        }

        const pipeline = [
            {
                $match: {
                    $or: [
                        { operationType: 'update' },
                        { operationType: 'replace' },
                        { operationType: 'insert' }
                    ]
                }
            }
        ];

        try {
            this.listingStream = this.listingModel.watch(pipeline, options);

            this.listingStream.on('change', async (change: any) => {
                await this.handleListingChange(change);
                await this.saveResumeToken('listings-watcher', change._id);
            });

            this.listingStream.on('error', async (err: any) => {
                this.logger.error(`Listing Stream Error: ${err.message}`);
                // Check for Oplog/Resume errors
                if (err.message && (
                    err.message.includes('Resume of change stream was not possible') ||
                    err.message.includes('resume point may no longer be in the oplog')
                )) {
                    this.logger.warn('Invalid resume token detected for listings. Deleting token and restarting watcher...');
                    await this.watcherTokenModel.deleteOne({ watcherName: 'listings-watcher' });
                    this.listingStream.close().catch(() => { });
                    setTimeout(() => this.startListingWatcher(), 1000);
                }
            });

            this.logger.log('Listing Watcher started successfully.');

        } catch (err) {
            this.logger.error(`Failed to start listing watcher: ${err.message}`);
        }
    }

    private async handleListingChange(change: any) {
        const listingId = change.documentKey._id.toString();

        this.logger.log(`[STREAM DEBUG] Raw Listing Event: ${change.operationType} on ${listingId}`);
        if (change.updateDescription) {
            this.logger.debug(`[STREAM DEBUG] Listing Update Fields: ${JSON.stringify(change.updateDescription.updatedFields)}`);
        }

        // [FIX] Handle 'replace' and 'insert' operations
        if (change.operationType === 'replace' || change.operationType === 'insert') {
            this.debounce(`listing-replace-${listingId}`, async () => {
                this.logger.log(`Detected ${change.operationType.toUpperCase()} operation for listing ${listingId}. triggering sync.`);
                await this.orchestrator.syncListing(listingId);
            });
            return;
        }

        const updatedFields = change.updateDescription?.updatedFields || {};
        const fieldKeys = Object.keys(updatedFields);

        // 1. Check for Title change
        if (fieldKeys.includes('title')) {
            this.debounce(`listing-title-${listingId}`, async () => {
                this.logger.log(`[GlobalWatcher] Title changed for listing ${listingId}. triggering sync.`);
                await this.orchestrator.syncListing(listingId);
            });
            return;
        }

        // 2. Check for Status change
        if (fieldKeys.includes('status')) {
            const newStatus = updatedFields['status'];
            // [LOOP PREVENTION] Ignore if lastSyncAt is also updated
            if (fieldKeys.includes('lastSyncAt')) {
                return;
            }

            if (['active', 'paused'].includes(newStatus)) {
                this.debounce(`listing-status-${listingId}`, async () => {
                    this.logger.log(`[GlobalWatcher] Status changed to '${newStatus}' for listing ${listingId}. triggering sync.`);
                    await this.orchestrator.syncListing(listingId);
                });
            }
        }
    }

    // --- Helpers ---

    private toNumber(value: any): number {
        if (value && typeof value.toString === 'function') {
            return Number(value.toString());
        }
        return Number(value);
    }
}
