import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { MarketplaceModel, MarketplaceDocument } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { MarketplaceSyncPayload } from './dto/marketplace-sync.dto';

import { PublicationContext } from './interfaces/publication-context.interface';
import { PublicationContextService } from './services/publication-context.service';

@Injectable()
export class MarketplaceOrchestratorService {
    private readonly logger = new Logger(MarketplaceOrchestratorService.name);

    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
        private readonly amqpConnection: AmqpConnection,
        private readonly publicationLogService: PublicationLogService,
        private readonly publicationContextService: PublicationContextService,
    ) { }


    /**
     * Sync a product to all marketplaces where it has a listing.
     * Can optionally filter by specific marketplaceId (e.g. for attribute changes)
     */
    async syncProductToAllMarketplaces(productId: string, targetMarketplaceId?: string): Promise<void> {
        this.logger.log(`Syncing product ${productId} to all marketplaces${targetMarketplaceId ? ` (Target: ${targetMarketplaceId})` : ''}`);

        // Removed status filter to allow auto-correction of error'd listings
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

        for (const listing of listings) {
            await this.syncListing(listing._id.toString());
        }
    }

    async syncListing(listingId: string): Promise<void> {
        this.logger.log(`Syncing Listing ${listingId}`);

        try {
            // Use centralized context builder (matches manual publish flow)
            // Handles token validation, marketplace enabled check, and relation population
            const publicationContext = await this.publicationContextService.buildContext(listingId);

            await this.publishListing(publicationContext);
        } catch (error) {
            this.logger.error(`Failed to sync listing ${listingId}: ${error.message}`);
        }
    }

    async publishListing(context: PublicationContext): Promise<string> {
        const { listing, product, marketplace, jobId } = context;

        this.logger.log(`Starting publish job ${jobId} for listing ${listing._id}`);

        // 1. Dynamic Requirement Validation (Decoupled Logic)
        try {
            this.validateRequirements(product, marketplace);
        } catch (error) {
            throw error;
        }

        // 2. Create Publication Attempt Log
        this.logger.debug(`Creating attempt log for ${jobId}...`);
        const attempt = await this.publicationLogService.createAttempt(
            product._id.toString(),
            'MarketplaceOrchestrator',
            [marketplace._id.toString()],
            { listingId: listing._id.toString(), jobId }
        );

        // 3. Process Template & Payload Construction
        this.logger.debug(`Constructing payload for ${jobId}...`);
        const payload = await this.constructPayload(jobId, listing, product, marketplace);
        payload.attemptId = attempt._id.toString(); // Inject Attempt ID

        // 4. Dispatch to RabbitMQ
        const routingKey = `sync.${marketplace.tag.toLowerCase()}`;
        this.logger.debug(`Publishing to RabbitMQ (${routingKey})...`);
        await this.amqpConnection.publish('rocket.marketplace.sync', routingKey, payload);
        this.logger.debug(`Published to RabbitMQ.`);

        // 5. Update Listing Status (This is a side effect - technically orchestrator shouldn't probably update DB directly if we are strict, 
        // but for now listing object is Mongoose Document, so save() works if we keep it decoupled from fetching)
        // Ideally, context service handles status updates via listener, but here we set initial status.
        // Since we have the document, we can save it.
        listing.status = 'pending_creation';
        listing.errorMessage = null;
        await listing.save();

        this.logger.log(`Dispatched job ${jobId} (Attempt ${attempt._id}) to ${routingKey}`);
        return jobId;
    }

    private validateRequirements(product: ProductDocument, marketplace: MarketplaceDocument) {
        if (!marketplace.requirements) return;

        const missingFields: string[] = [];
        for (const req of marketplace.requirements) {
            if (req.isRequired) {
                const value = this.getNestedValue(product, req.schemaField);

                // Generic "Empty" Check
                if (value === undefined || value === null || value === '') {
                    missingFields.push(req.displayName || req.fieldName);
                    continue; // Skip further checks for this field
                }

                // Specific Check for Price (must be > 0)
                if (req.fieldName === 'price' || req.schemaField === 'price') {
                    if (Number(value) <= 0) {
                        missingFields.push(`${req.displayName || req.fieldName} (must be greater than 0)`);
                    }
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

        // Process Title & Description
        const { title: templateTitle, description } = this.processTemplate(product, marketplace, listing);

        // Use Listing Title if available (User Override), otherwise use Template/Product Name
        const title = listing.title || templateTitle;

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
                price: Number(listing.price || product.price?.toString() || 0),
                stock: this.calculateStock(product),
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

    private processTemplate(product: ProductDocument, marketplace: MarketplaceDocument, listing: ListingDocument): { title: string, description: string } {
        // Simple Template Engine
        // TODO: Select specific template based on rules if needed. Using default for now.
        const template = marketplace.templates?.find(t => t.isDefault && t.isActive) || marketplace.templates?.[0];
        let title = product.name;
        let description = product.description;

        if (template) {
            // Resolve Title if template has one
            if (template.title) {
                title = this.resolveTemplate(template.title, product, listing.title);
            }

            // Resolve Description
            description = this.resolveTemplate(template.template, product, listing.title);

            // Process Sections (Ported from MarketplaceDescriptionService)
            const sections = template.sections || ((template as any)._doc && (template as any)._doc.sections);

            if (sections) {
                for (const section of sections) {
                    if (section.condition && section.content) {
                        try {
                            const conditionMet = this.evaluateCondition(section.condition, product);

                            if (conditionMet) {
                                // Remove tags but keep content
                                const sectionContent = section.content
                                    .replace(/\[[A-Z_]+_SECTION\]\s*/g, '')
                                    .replace(/\[\/[A-Z_]+_SECTION\]\s*/g, '');

                                if (description.includes(section.content)) {
                                    description = description.replace(section.content, sectionContent);
                                }
                            } else {
                                // Remove the entire section content including tags from the template
                                description = description.replace(section.content, '');
                            }
                        } catch (error) {
                            this.logger.warn(`Error evaluating section condition: ${error.message}`);
                        }
                    }
                }
            }

            // Cleanup leftover tags
            description = description.replace(/\[[A-Z_]+_SECTION\]/g, '').replace(/\[\/[A-Z_]+_SECTION\]/g, '');
        }

        return { title, description };
    }

    private resolveTemplate(templateStr: string, product: ProductDocument, overrideTitle?: string): string {
        // this.logger.debug(`[ResolveTemplate] OverrideTitle: "${overrideTitle}"`); // Commented to reduce noise, enable if needed
        let processed = templateStr;

        // Helpers
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
            if (!partNumber || capitalizedName.includes(partNumber)) {
                return capitalizedName;
            }
            const nameWithPartNumber = `${capitalizedName} ${partNumber}`.trim();
            return nameWithPartNumber.length <= 60 ? nameWithPartNumber : capitalizedName;
        };

        // Variable Replacement
        processed = processed
            .replace(/\{produto\}/g, overrideTitle || formatProductName(product.name || '', product.partNumber || ''))
            .replace(/\{marca\}/g, product.brand?.amazonName || product.brand?.name || '')
            .replace(/\{modelo\}/g, product.partNumber || '')
            .replace(/\{descricao_curta\}/g, product.description || '')
            .replace(/\{preco\}/g, product.price ? Number(product.price).toFixed(2) : '0.00')
            .replace(/\{codigo\}/g, product.barcode || product.partNumber || '')
            .replace(/\{peso\}/g, product.weight ? product.weight.toString() : '0')
            .replace(/\{comprimento\}/g, product.dimensions?.length ? product.dimensions.length.toString() : '0')
            .replace(/\{largura\}/g, product.dimensions?.width ? product.dimensions.width.toString() : '0')
            .replace(/\{altura\}/g, product.dimensions?.height ? product.dimensions.height.toString() : '0')
            .replace(/\{categoria\}/g, (product.category as any)?.name || '');

        // Generic fallback for any other keys matching {key}
        processed = processed.replace(/{(\w+)}/g, (_, key) => {
            return (product as any)[key] || '';
        });

        return processed;
    }

    private calculateStock(product: ProductDocument): number {
        const qty = product.stockQuantity || 0;
        const reserved = product.stockReserved || 0;
        return Math.max(0, qty - reserved);
    }

    private evaluateCondition(condition: string, product: ProductDocument): boolean {
        if (condition.includes('>')) {
            const [field, value] = condition.split('>').map(s => s.trim());
            const productValue = this.getProductValue(field, product);
            return productValue > parseFloat(value);
        }

        if (condition.includes('<')) {
            const [field, value] = condition.split('<').map(s => s.trim());
            const productValue = this.getProductValue(field, product);
            return productValue < parseFloat(value);
        }

        if (condition.includes('==')) {
            const [field, value] = condition.split('==').map(s => s.trim());
            const productValue = this.getProductValue(field, product);

            const numValue = Number(value);
            const numProductValue = Number(productValue);

            if (!isNaN(numValue) && !isNaN(numProductValue)) {
                return numProductValue === numValue;
            }

            const cleanValue = value.replace(/^['"](.*)['"]$/, '$1');
            return String(productValue) === cleanValue;
        }

        if (condition.includes('!=')) {
            const [field, value] = condition.split('!=').map(s => s.trim());
            const productValue = this.getProductValue(field, product);
            if (value === 'null') {
                return productValue !== null && productValue !== undefined;
            }
            const cleanValue = value.replace(/^['"](.*)['"]$/, '$1');
            return productValue !== cleanValue;
        }

        return false;
    }

    private getProductValue(field: string, product: ProductDocument): any {
        const parts = field.split('.');
        let value: any = product;

        for (const part of parts) {
            if (value === null || value === undefined) {
                return null;
            }
            value = value[part];
        }

        return value;
    }
}
