import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { MarketplaceModel, MarketplaceDocument } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';
import { StockMovementModel, StockMovementDocument } from '../product/schemas/stock-movement.schema';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceSyncPayload } from './dto/marketplace-sync.dto';
import { ProductRepository } from '../product/product.repository';

import { PublicationContext } from './interfaces/publication-context.interface';
import { PublicationContextService } from './services/publication-context.service';

@Injectable()
export class MarketplaceOrchestratorService {
    private readonly logger = new Logger(MarketplaceOrchestratorService.name);

    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
        @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
        private readonly amqpConnection: AmqpConnection,
        private readonly publicationLogService: PublicationLogService,
        private readonly publicationContextService: PublicationContextService,
        private readonly descriptionService: MarketplaceDescriptionService,
        private readonly productRepository: ProductRepository,
    ) { }


    /**
     * Sync a product to all marketplaces where it has a listing.
     * Can optionally filter by specific marketplaceId (e.g. for attribute changes)
     */
    async syncProductToAllMarketplaces(productId: string, targetMarketplaceId?: string, requesterId?: string, force = false): Promise<void> {
        this.logger.log(`Syncing product ${productId} to all marketplaces${targetMarketplaceId ? ` (Target: ${targetMarketplaceId})` : ''} by ${requesterId || 'system'}${force ? ' [FORCED]' : ''}`);

        const query: any = { productId: new Types.ObjectId(productId) };

        if (targetMarketplaceId) {
            query.marketplaceId = new Types.ObjectId(targetMarketplaceId);
        }

        const listings = await this.listingModel.find(query).exec();

        if (!listings || listings.length === 0) {
            this.logger.log(`No listings found for product ${productId}`);
            return;
        }

        this.logger.log(`Found ${listings.length} listings to sync for product ${productId}`);

        const errors: Error[] = [];
        for (const listing of listings) {
            try {
                await this.syncListing(listing._id.toString(), requesterId, force);
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw new Error(`${errors.length}/${listings.length} listing(s) failed: ${errors.map(e => e.message).join('; ')}`);
        }
    }

    async syncListing(listingId: string, requesterId?: string, force = false): Promise<void> {
        this.logger.log(`Syncing Listing ${listingId} by ${requesterId || 'system'}${force ? ' [FORCED]' : ''}`);

        try {
            const publicationContext = await this.publicationContextService.buildContext(listingId, requesterId);
            await this.publishListing(publicationContext, requesterId, force);
        } catch (error) {
            this.logger.error(`Failed to sync listing ${listingId}: ${error.message}`);
            // Surface the error on the listing so the user can see it
            await this.listingModel.findByIdAndUpdate(listingId, {
                $set: {
                    status: 'error',
                    errorMessage: error.message,
                    publishingAt: null, // Release lock so future syncs can retry
                },
            }).exec().catch(() => { /* ignore update failure */ });
            throw error; // Re-throw so SyncQueueWorker can apply backoff retry
        }
    }

    async publishListing(context: PublicationContext, requesterId?: string, force = false): Promise<string | null> {
        const { listing, product, marketplace, jobId } = context;

        // Early exit for marketplaces without an active token.
        // This is a configuration gap, not a product error — do not mark the listing as errored.
        const hasActiveToken = marketplace.tokens?.some(t => t.isActive);
        if (!hasActiveToken) {
            this.logger.warn(
                `[SkipNoToken] Listing ${listing._id} skipped — no active token for marketplace ${marketplace.name}`
            );
            return null;
        }

        // Atomic in-flight lock using a dedicated `publishingAt` timestamp field.
        //
        // Why not `status: pending_creation`?
        //   - status is a semantic field reset by ListingStatusListener to 'active' as soon as
        //     the marketplace API responds — BEFORE the next sync may start. Using it as a lock
        //     creates a race window.
        //   - The old guard was wrapped in `if (!force)`, meaning force=true (user_publish) always
        //     bypassed it entirely, causing duplicate dispatches when operational_change and
        //     user_publish overlapped.
        //
        // How this lock works:
        //   1. Before ANY dispatch (force or not), atomically set publishingAt = now IF either:
        //        a. publishingAt is null/unset (listing is idle), OR
        //        b. publishingAt is older than 2 minutes (stale lock from crash/timeout)
        //   2. If the atomic update returns no document → another sync is in flight → skip.
        //   3. ListingStatusListener clears publishingAt = null when the job result arrives.
        const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes
        const lockExpiry = new Date(Date.now() - LOCK_TTL_MS);
        const claimed = await this.listingModel.findOneAndUpdate(
            {
                _id: listing._id,
                $or: [
                    { publishingAt: null },
                    { publishingAt: { $exists: false } },
                    { publishingAt: { $lt: lockExpiry } },
                ],
            },
            { $set: { publishingAt: new Date(), status: 'pending_creation', errorMessage: null } }
        ).exec();

        if (!claimed) {
            this.logger.warn(
                `[AtomicGuard] Listing ${listing._id} already has an in-flight publish. Skipping duplicate dispatch.`
            );
            return null;
        }

        this.logger.log(`Starting publish job ${jobId} for listing ${listing._id}${force ? ' [FORCED]' : ''}`);

        // 1. Create Publication Attempt Log
        const attempt = await this.publicationLogService.createAttempt(
            product._id.toString(),
            'MarketplaceOrchestrator',
            [marketplace._id.toString()],
            { listingId: listing._id.toString(), jobId }
        );

        // 2. Build payload first — listing.price takes priority over product.price,
        //    category is resolved from marketplaceMappings, etc.
        const payload = await this.constructPayload(jobId, listing, product, marketplace);
        payload.attemptId = attempt._id.toString(); // Inject Attempt ID

        // 3. Validate RESOLVED values (post-construction).
        //    validateRequirements() was checking product.price directly, which is 0 when
        //    the price lives on the listing. Now we validate the actual values that will
        //    be sent to the marketplace API.
        this.validateResolvedPayload(payload, marketplace);

        // Inject User ID into metadata
        if (requesterId) {
            payload.metadata = payload.metadata || {};
            payload.metadata.userId = requesterId;
        }

        // 4. Dispatch to RabbitMQ
        const routingKey = `sync.${marketplace.tag.toLowerCase()}`;
        await this.amqpConnection.publish('rocket.marketplace.sync', routingKey, payload);

        // Status and publishingAt lock were already atomically set in the guard above.

        this.logger.log(`Dispatched job ${jobId} (Attempt ${attempt._id}) to ${routingKey}`);
        return jobId;
    }

    /**
     * Validates the CONSTRUCTED payload — not the raw product document.
     *
     * Root cause of the old bug:
     *   validateRequirements() was reading product.price directly. In this system prices
     *   are often stored per-listing (listing.price > 0, product.price = 0). constructPayload()
     *   correctly uses `listing.price || product.price`, but the old validation ran before
     *   construction and always read 0 from the product, failing every sync triggered from
     *   the order/stock flow.
     *
     * Same problem applied to other fields (brand, category) that get resolved differently
     * during payload construction.
     */
    /**
     * Resolves selling price using a priority chain:
     *   1. listing.price (marketplace-specific override)
     *   2. product.price (product-level default)
     *   3. Most recent inbound stock_movement.price (Sales Price snapshot)
     *
     * This handles the common case where price is set on stock entries rather
     * than directly on the product or listing documents.
     */
    private async resolvePrice(
        productId: string,
        listing: ListingDocument,
        product: ProductDocument,
    ): Promise<number> {
        const listingPrice = Number(listing.price || 0);
        if (listingPrice > 0) return parseFloat(listingPrice.toFixed(2));

        const productPrice = Number(product.price?.toString() || 0);
        if (productPrice > 0) return parseFloat(productPrice.toFixed(2));

        // Fallback: latest inbound movement that carries a price
        const movement = await this.stockMovementModel
            .findOne({
                productId: new Types.ObjectId(productId) as any,
                type: 'inbound',
                price: { $exists: true, $ne: null },
            })
            .sort({ date: -1 })
            .select('price')
            .lean()
            .exec();

        if (movement?.price) {
            const movementPrice = Number(movement.price.toString());
            if (movementPrice > 0) {
                this.logger.log(`[resolvePrice] Using stock movement price ${movementPrice} for product ${productId}`);
                return parseFloat(movementPrice.toFixed(2));
            }
        }

        return 0;
    }

    private validateResolvedPayload(payload: MarketplaceSyncPayload, marketplace: MarketplaceDocument) {
        if (!marketplace.requirements) return;

        // For UPDATE actions the product is already live on the marketplace.
        // We only re-validate on CREATE to avoid blocking operational syncs (stock/price updates)
        // on listings that may have been created before all required fields were set.
        if (payload.action === 'UPDATE') return;

        const p = payload.payload;
        const productSnapshot = payload.product;
        const missingFields: string[] = [];

        // Resolve value for a given requirement against the CONSTRUCTED payload.
        const resolve = (schemaField: string, fieldName: string): any => {
            const field = schemaField || fieldName;
            switch (field) {
                // Price lives in payload.payload.price (already resolved as listing.price || product.price)
                case 'price':
                    return p.price;

                // Stock is calculated from stock_movements aggregation
                case 'stock':
                case 'stockQuantity':
                    return p.stock;

                // Brand: prefer resolved payload value; 'Generic' means it was never set
                case 'brand':
                case 'brand.name':
                    return (p.brand && p.brand !== 'Generic') ? p.brand : productSnapshot?.brand?.name;

                // Title from the processed template
                case 'name':
                case 'title':
                    return p.title;

                // Images
                case 'images':
                    return (p.images && p.images.length > 0) ? p.images : undefined;

                // Category: check if the product snapshot has a category assigned.
                // constructPayload falls back to a hardcoded ML category when unset, so
                // we validate the source field on the product rather than the fallback value.
                case 'category':
                case 'categoryId': {
                    const cat = productSnapshot?.category;
                    // Valid if it's an ObjectId string, a populated object, or any truthy value
                    return (cat && cat !== null) ? cat : undefined;
                }

                default:
                    // For any other field, try the payload object first then the product snapshot
                    return (p as any)[field] ?? this.getNestedValue(productSnapshot, field);
            }
        };

        for (const req of marketplace.requirements) {
            if (!req.isRequired) continue;

            const value = resolve(req.schemaField, req.fieldName);

            // Empty check (undefined, null, empty string, or empty array)
            if (value === undefined || value === null || value === '' ||
                (Array.isArray(value) && value.length === 0)) {
                missingFields.push(req.displayName || req.fieldName);
                continue;
            }

            // Price must be > 0
            if (req.schemaField === 'price' || req.fieldName === 'price') {
                if (Number(value) <= 0) {
                    missingFields.push(`${req.displayName || req.fieldName} (must be greater than 0)`);
                }
            }

            // Stock must be > 0 — zero-stock listings must not be pushed to any marketplace
            if (req.schemaField === 'stock' || req.fieldName === 'stock' ||
                req.schemaField === 'stockQuantity' || req.fieldName === 'stockQuantity') {
                if (Number(value) <= 0) {
                    missingFields.push(`${req.displayName || req.fieldName} (estoque deve ser maior que 0)`);
                }
            }
        }

        if (missingFields.length > 0) {
            throw new BadRequestException(`Missing required fields for ${marketplace.name}: ${missingFields.join(', ')}`);
        }
    }

    private getNestedValue(obj: any, path: string) {
        if (!path) return undefined;
        return path.split('.').reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
    }

    async constructPayload(
        jobId: string,
        listing: ListingDocument,
        product: ProductDocument,
        marketplace: MarketplaceDocument
    ): Promise<MarketplaceSyncPayload> {

        // Find Active Token
        const activeToken = marketplace.tokens?.find(t => t.isActive);
        if (!activeToken) {
            throw new BadRequestException(`No active token found for marketplace ${marketplace.name}`);
        }

        // Process Title (template title field) and Description (via TemplateEngine)
        const templateTitle = this.resolveTitle(product, marketplace, listing);
        const title = listing.title || templateTitle;

        // Generate description using the centralized TemplateEngine (sections processed BEFORE placeholders)
        const description = await this.generateDescription(product, marketplace, listing);

        // Map Attributes (Preserve Metadata)
        const attributes: any[] = [];
        if (product.attributes) {
            product.attributes.forEach(attr => {
                // Should ideally filter by marketplaceId or use a dedicated method
                if (!attr.marketplaceId || attr.marketplaceId.toString() === marketplace._id.toString()) {
                    // Use 'code' which holds the External ID (e.g., 'BRAND') instead of 'name' (Label)
                    attributes.push({
                        id: attr.code || attr.name,
                        value: attr.value,
                        valueName: attr.valueName,
                        valueType: attr.valueType
                    });
                }
            });
        }

        // Resolve Category External ID
        let categoryExternalId = 'MLB3530'; // Default fallback
        if (product.category && typeof product.category !== 'string' && 'marketplaceMappings' in product.category) {
            try {
                const category = product.category as any; // Cast to access populated fields safely

                if (category.marketplaceMappings) {
                    const mapping = category.marketplaceMappings.find(
                        (m: any) => m.marketplaceId.toString() === marketplace._id.toString()
                    );
                    if (mapping && mapping.externalId) {
                        categoryExternalId = mapping.externalId;
                    }
                }
            } catch (err) {
                this.logger.warn(`Failed to resolve category external ID from population: ${err.message}`);
            }
        }

        // Action Determination
        const action = listing.externalId ? 'UPDATE' : 'CREATE';

        // Price resolution: listing override → product price → latest inbound stock movement price
        const resolvedPrice = await this.resolvePrice(product._id.toString(), listing, product);

        return {
            jobId,
            listingId: listing._id.toString(),
            marketplaceId: marketplace._id.toString(),
            externalId: listing.externalId,
            action,

            product: product.toObject(), // Send full object for flexibility
            marketplace: {
                tag: marketplace.tag,
                credentials: {
                    accessToken: activeToken.accessToken,
                    refreshToken: activeToken.refreshToken,
                    expiresAt: activeToken.expiresAt?.toISOString(),
                    ...activeToken.additionalData
                },
                settings: marketplace.settings
            },
            payload: {
                title: title,
                description: description,
                price: resolvedPrice,
                stock: await this.calculateStock(product),
                sku: product._id.toString(),
                brand: product.brand?.name || 'Generic', // Fallback if missing
                images: product.images?.map(i => i.url) || [],
                attributes: [
                    ...attributes,
                    { id: 'category_id', value: categoryExternalId }
                ],
                dimensions: {
                    length: Number(product.dimensions?.length?.toString() || 0),
                    width: Number(product.dimensions?.width?.toString() || 0),
                    height: Number(product.dimensions?.height?.toString() || 0),
                    weight: Number(product.weight?.toString() || 0)
                }
            }
        };
    }

    /**
     * Resolves title from the marketplace's default template, falling back to product.name.
     * Returns a plain string — no async, no DB calls.
     */
    private resolveTitle(product: ProductDocument, marketplace: MarketplaceDocument, listing: ListingDocument): string {
        const template = marketplace.templates?.find(t => t.isDefault && t.isActive) ?? marketplace.templates?.[0];
        if (!template?.title) return product.name || '';

        const capitalizeText = (text: string): string => {
            if (!text) return '';
            return text.split(' ').map(word => {
                if (word.length <= 2) return word;
                if (word[0] === word[0].toUpperCase()) return word;
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join(' ');
        };

        const formatProductName = (name: string, partNumber: string): string => {
            const capitalizedName = capitalizeText(name);
            if (!partNumber || capitalizedName.includes(partNumber)) return capitalizedName;
            const nameWithPartNumber = `${capitalizedName} ${partNumber}`.trim();
            return nameWithPartNumber.length <= 60 ? nameWithPartNumber : capitalizedName;
        };

        return template.title
            .replace(/\{produto\}/g, formatProductName(product.name || '', product.partNumber || ''))
            .replace(/\{marca\}/g, product.brand?.amazonName || product.brand?.name || '')
            .replace(/\{modelo\}/g, product.partNumber || '')
            .replace(/\{(\w+)\}/g, (_, key) => (product as any)[key] ?? '');
    }

    /**
     * Generates description via the centralized TemplateEngine.
     * Sections are processed BEFORE placeholders — this prevents blank lines
     * from empty placeholders inside inactive conditional sections.
     * listing.title is passed so {produto} in the description body matches the actual ML title.
     */
    private async generateDescription(product: ProductDocument, marketplace: MarketplaceDocument, listing: ListingDocument): Promise<string> {
        try {
            return await this.descriptionService.generateDescription(product, marketplace.name, undefined, listing.title || undefined);
        } catch (err) {
            this.logger.warn(`[generateDescription] Falling back to product.description: ${err.message}`);
            return product.description || '';
        }
    }

    private async calculateStock(product: ProductDocument): Promise<number> {
        const productId = (product._id || product.id)?.toString();
        return this.productRepository.calculateStock(productId);
    }

}
