import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StockMovementDocument, StockMovementModel } from '../schemas/stock-movement.schema'; // Adjust path if needed
import { ProductRepository } from '../product.repository';

@Injectable()
export class StockWatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(StockWatcherService.name);
    private changeStream: any;
    private debounceMap = new Map<string, NodeJS.Timeout>();
    private readonly DEBOUNCE_MS = 2000; // 2 seconds debounce to batch rapid updates

    constructor(
        @InjectModel(StockMovementModel.name)
        private stockMovementModel: Model<StockMovementDocument>,
        private readonly productRepository: ProductRepository,
    ) { }

    async onModuleInit() {
        this.startWatcher();
    }

    async onModuleDestroy() {
        if (this.changeStream) {
            await this.changeStream.close();
        }
    }

    private startWatcher() {
        this.logger.log('Iniciando StockWatcherService (MongoDB Change Streams)...');

        const pipeline = [
            {
                $match: {
                    $or: [
                        { operationType: 'insert' },
                        { operationType: 'update' },
                        { operationType: 'replace' },
                        { operationType: 'delete' },
                    ],
                },
            },
        ];

        this.changeStream = this.stockMovementModel.watch(pipeline, { fullDocument: 'updateLookup' });

        this.changeStream.on('change', (change) => {
            this.handleStockChange(change);
        });

        this.changeStream.on('error', (error) => {
            this.logger.error('Erro no Change Stream de StockMovements:', error);
        });
    }

    private async handleStockChange(change: any) {
        let productId: string | undefined;

        if (change.operationType === 'delete') {
            // For delete, we need the documentKey usually, but we might lose context of which product it was unless we have fullDocumentBeforeChange (requires pre-image config)
            // Or if the deleted document ID allows us to infer? No.
            // However, often deletes are rare or handled via soft-delete. 
            // If we can't reliably get the product ID on delete without pre-image, we might skip or log warning.
            // But 'updateLookup' doesn't help for delete.
            // Ideally application should use soft-delete or we accept that hard-deletes might need manual sync if pre-images arent on.
            // Let's attempt to proceed if we can find a product ID in the documentKey or fullDocument if insert/update.

            // Actually, for delete, 'documentKey' is available which is the _id of the movement. 
            // We can't know the product ID from just the movement ID after it's gone.
            // Limitation: Hard deletes of movements won't auto-trigger sync unless we enable pre-images in Mongo config.
            // Assuming this service mostly handles inserts/updates for now.
            this.logger.warn(`Movement deleted: ${change.documentKey._id}. Auto-sync might not trigger if pre-images are disabled.`);
            return;
        } else {
            const doc = change.fullDocument;
            if (doc && doc.product) {
                productId = doc.product.toString();
            }
        }

        if (productId) {
            this.scheduleSync(productId);
        }
    }

    private scheduleSync(productId: string) {
        if (this.debounceMap.has(productId)) {
            clearTimeout(this.debounceMap.get(productId));
        }

        const timeout = setTimeout(() => {
            this.debounceMap.delete(productId);
            this.executeSync(productId);
        }, this.DEBOUNCE_MS);

        this.debounceMap.set(productId, timeout);
    }

    private async executeSync(productId: string) {
        try {
            this.logger.debug(`[StockWatcher] Recalculating stock for Product ${productId}`);
            const newStock = await this.productRepository.syncStockFromMovements(productId);
            this.logger.debug(`[StockWatcher] Stock updated for ${productId}: ${newStock}`);
        } catch (error) {
            this.logger.error(`[StockWatcher] Failed to sync stock for ${productId}: ${error.message}`);
        }
    }
}
