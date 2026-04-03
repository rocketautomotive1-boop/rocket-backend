import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';
import { WatcherToken, WatcherTokenDocument } from './schemas/watcher-token.schema';
import { StockMovementModel, StockMovementDocument } from '../product/schemas/stock-movement.schema';
import { ProductRepository } from '../product/product.repository';
import { SyncQueueService } from './services/sync-queue.service';
import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';

@Injectable()
export class GlobalWatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(GlobalWatcherService.name);
    private productStream: mongo.ChangeStream;
    private listingStream: mongo.ChangeStream;
    private movementStream: mongo.ChangeStream;

    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
        @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
        @InjectModel(WatcherToken.name) private watcherTokenModel: Model<WatcherTokenDocument>,
        private readonly syncQueueService: SyncQueueService,
        private readonly orchestrator: MarketplaceOrchestratorService,
        private readonly productRepository: ProductRepository,
    ) { }

    async onModuleInit() {
        this.logger.log('Initializing GlobalWatcherService...');
        await this.startProductWatcher();
        await this.startListingWatcher();
        await this.startStockMovementWatcher();
    }

    async onModuleDestroy() {
        if (this.productStream) await this.productStream.close();
        if (this.listingStream) await this.listingStream.close();
        if (this.movementStream) await this.movementStream.close();
    }

    // --- Resume Token Helpers ---

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

    // --- Debounce (watcher-side, reduces write frequency to the queue) ---

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
                this.logger.error(`Error in debounced callback for ${key}: ${err.message}`, err.stack);
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
            this.logger.log('Resuming products stream from token...');
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
                await this.handleProductChange(change);
                await this.saveResumeToken('products-watcher', change._id);
            });

            this.productStream.on('error', async (err: any) => {
                this.logger.error(`Product Stream Error: ${err.message}`, err.stack);
                if (err.message?.includes('Resume of change stream was not possible') ||
                    err.message?.includes('resume point may no longer be in the oplog')) {
                    this.logger.warn('Invalid resume token for products. Clearing and restarting...');
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

    private async handleProductChange(change: any) {
        const productId = change.documentKey._id.toString();

        // INSERT/REPLACE = product creation or bulk write, not a publish intent.
        // Content publishing is an explicit user action via POST /sync-product/:id.
        if (change.operationType === 'replace' || change.operationType === 'insert') {
            this.logger.debug(`[Watcher] Skipping auto-enqueue for ${change.operationType.toUpperCase()} on product ${productId}.`);
            return;
        }

        const updatedFields = change.updateDescription?.updatedFields || {};
        const fieldKeys = Object.keys(updatedFields);

        // Only operational fields (price, active) trigger auto-sync.
        // Content changes (images, title, attributes, category, etc.) are published
        // explicitly by the user via POST /marketplace-orchestrator/sync-product/:productId.
        const operationalFields = ['price', 'active'];
        const hasOperationalChange = fieldKeys.some(key => operationalFields.includes(key.split('.')[0]));

        if (hasOperationalChange) {
            this.debounce(`product-sync-${productId}`, async () => {
                this.logger.log(`[Watcher] Operational field changed for product ${productId}. Enqueuing sync.`);
                await this.syncQueueService.enqueue({
                    productId,
                    reason: 'operational_change',
                });
            });
        }
    }

    // --- Listing Watcher ---

    private async startListingWatcher() {
        const resumeToken = await this.getResumeToken('listings-watcher');
        const options: any = { fullDocument: 'updateLookup' };
        if (resumeToken) {
            options.resumeAfter = resumeToken;
            this.logger.log('Resuming listings stream from token...');
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
                if (err.message?.includes('Resume of change stream was not possible') ||
                    err.message?.includes('resume point may no longer be in the oplog')) {
                    this.logger.warn('Invalid resume token for listings. Clearing and restarting...');
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

        // INSERT/REPLACE = new listing created, not a publish signal.
        if (change.operationType === 'replace' || change.operationType === 'insert') {
            this.logger.debug(`[Watcher] Skipping auto-sync for listing ${listingId} ${change.operationType.toUpperCase()}.`);
            return;
        }

        const updatedFields = change.updateDescription?.updatedFields || {};
        const fieldKeys = Object.keys(updatedFields);

        // Title change on a listing → sync that specific listing directly.
        // Listing-level changes bypass the SyncQueue (they are already per-listing scoped).
        if (fieldKeys.includes('title')) {
            this.debounce(`listing-title-${listingId}`, async () => {
                this.logger.log(`[Watcher] Title changed for listing ${listingId}. Triggering direct sync.`);
                await this.orchestrator.syncListing(listingId);
            });
            return;
        }

        // Status change (active/paused) → sync the listing directly.
        if (fieldKeys.includes('status')) {
            // [LOOP PREVENTION] Ignore if lastSyncAt was also updated in the same op —
            // that means the status change originated from a sync result, not user action.
            if (fieldKeys.includes('lastSyncAt')) {
                return;
            }

            const newStatus = updatedFields['status'];
            if (['active', 'paused'].includes(newStatus)) {
                this.debounce(`listing-status-${listingId}`, async () => {
                    this.logger.log(`[Watcher] Status changed to '${newStatus}' for listing ${listingId}. Triggering direct sync.`);
                    await this.orchestrator.syncListing(listingId);
                });
            }
        }
    }

    // --- Stock Movement Watcher ---

    private async startStockMovementWatcher() {
        const resumeToken = await this.getResumeToken('movements-watcher');
        const options: any = { fullDocument: 'updateLookup' };
        if (resumeToken) {
            options.resumeAfter = resumeToken;
            this.logger.log('Resuming movements stream from token...');
        }

        const pipeline = [
            {
                $match: {
                    $or: [
                        { operationType: 'insert' },
                        { operationType: 'update' },
                        { operationType: 'replace' },
                        { operationType: 'delete' }
                    ]
                }
            }
        ];

        try {
            this.movementStream = this.stockMovementModel.watch(pipeline, options);

            this.movementStream.on('change', async (change: any) => {
                await this.handleMovementChange(change);
                await this.saveResumeToken('movements-watcher', change._id);
            });

            this.movementStream.on('error', async (err: any) => {
                this.logger.error(`Movement Stream Error: ${err.message}`);
                if (err.message?.includes('Resume of change stream was not possible') ||
                    err.message?.includes('resume point may no longer be in the oplog')) {
                    this.logger.warn('Invalid resume token for movements. Clearing and restarting...');
                    await this.watcherTokenModel.deleteOne({ watcherName: 'movements-watcher' });
                    this.movementStream.close().catch(() => { });
                    setTimeout(() => this.startStockMovementWatcher(), 1000);
                }
            });

            this.logger.log('Stock Movement Watcher started successfully.');
        } catch (err) {
            this.logger.error(`Failed to start movement watcher: ${err.message}`);
        }
    }

    private async handleMovementChange(change: any) {
        if (change.operationType === 'delete') return;

        const productId: string | null =
            change.fullDocument?.productId?.toString() ||
            change.fullDocument?.product?.toString() ||
            null;

        if (!productId) return;

        // Recompute price from movements, then let the product change stream
        // detect the `price` field update and enqueue a sync automatically via SyncQueueService.
        this.debounce(`movements-${productId}`, async () => {
            this.logger.log(`[Watcher] Movement change for product ${productId}. Syncing price field...`);
            await this.productRepository.syncPriceFromMovements(productId);
        });
    }
}
