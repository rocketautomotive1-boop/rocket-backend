import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MarketplaceOrchestratorService } from '../marketplace-orchestrator.service';
import { PublicationContextService } from './publication-context.service';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

export interface PayloadPreviewResult {
    marketplace: string;
    action: 'CREATE' | 'UPDATE';
    listingId: string;
    externalId?: string;
    basePayload: any;
    marketplacePayloads: Record<string, any>;
}

@Injectable()
export class PayloadBuilderService {
    private readonly logger = new Logger(PayloadBuilderService.name);

    constructor(
        private readonly orchestratorService: MarketplaceOrchestratorService,
        private readonly contextService: PublicationContextService,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    ) { }

    // ================================================================
    //  PREVIEW (endpoint-facing)
    // ================================================================

    async buildPreview(listingId: string, forceAction?: 'CREATE' | 'UPDATE'): Promise<PayloadPreviewResult> {
        const context = await this.contextService.buildContext(listingId);
        const { listing, product, marketplace } = context;

        const basePayload = await this.orchestratorService.constructPayload(
            context.jobId,
            listing,
            product,
            marketplace,
        );

        if (forceAction) {
            basePayload.action = forceAction;
        }

        const tag = marketplace.tag.toLowerCase();
        let marketplacePayloads: Record<string, any>;

        switch (tag) {
            case 'amazon':
                marketplacePayloads = this.previewAmazon(basePayload);
                break;
            case 'shopee':
                marketplacePayloads = this.previewShopee(basePayload);
                break;
            case 'mercadolivre':
                marketplacePayloads = this.previewMercadoLivre(basePayload);
                break;
            case 'tiktokshop':
                marketplacePayloads = this.previewTikTokShop(basePayload);
                break;
            case 'olx':
                marketplacePayloads = this.previewOLX(basePayload);
                break;
            default:
                marketplacePayloads = { raw: basePayload.payload };
        }

        const sanitizedBase = {
            ...basePayload,
            marketplace: {
                ...basePayload.marketplace,
                credentials: '<<REDACTED>>',
            },
        };

        return {
            marketplace: tag,
            action: basePayload.action as 'CREATE' | 'UPDATE',
            listingId: basePayload.listingId,
            externalId: basePayload.externalId,
            basePayload: sanitizedBase,
            marketplacePayloads,
        };
    }

    async buildPreviewByProduct(productId: string): Promise<{ productId: string; previews: PayloadPreviewResult[]; errors: any[] }> {
        const listings = await this.listingModel
            .find({ productId: new Types.ObjectId(productId) })
            .exec();

        if (!listings || listings.length === 0) {
            throw new NotFoundException(`No listings found for product ${productId}`);
        }

        const previews: PayloadPreviewResult[] = [];
        const errors: any[] = [];

        for (const listing of listings) {
            try {
                const preview = await this.buildPreview(listing._id.toString());
                previews.push(preview);
            } catch (error) {
                errors.push({
                    listingId: listing._id.toString(),
                    marketplaceId: listing.marketplaceId?.toString(),
                    error: error.message,
                });
            }
        }

        return { productId, previews, errors };
    }

    private previewAmazon(msg: MarketplaceSyncPayload): Record<string, any> {
        const sku = String(msg.product._id);
        if (msg.action === 'DELETE') {
            return {
                delete: {
                    method: 'DELETE',
                    path: `/listings/2021-08-01/items/{sellerId}/${sku}`,
                    queryString: 'marketplaceIds=A2Q3Y263D00KWC',
                },
            };
        }
        return {
            putListingItem: {
                method: 'PUT',
                path: `/listings/2021-08-01/items/{sellerId}/${sku}`,
                queryString: 'marketplaceIds=A2Q3Y263D00KWC',
                body: this.buildAmazonSpApiPayload(msg),
            },
        };
    }

    private previewShopee(msg: MarketplaceSyncPayload): Record<string, any> {
        const placeholderImages = msg.payload.images?.map((_, i) => `<upload_required_image_${i}>`) || [];
        const result: Record<string, any> = {};

        if (msg.action === 'CREATE') {
            result.addItem = {
                endpoint: 'POST /product/add_item',
                body: this.buildShopeeCreateBody(msg, placeholderImages, [{ logistic_id: '<resolved_from_get_channel_list>', enabled: true, is_free: false }]),
            };
        } else if (msg.action === 'DELETE') {
            result.unlistItem = {
                endpoint: 'POST /product/unlist_item',
                body: this.buildShopeeDeleteBody(msg.externalId),
            };
        } else if (msg.action === 'UPDATE') {
            result.updateItem = {
                endpoint: 'POST /product/update_item',
                body: this.buildShopeeUpdateItemBody(msg, placeholderImages),
            };
            result.updateStock = {
                endpoint: 'POST /product/update_stock',
                body: this.buildShopeeStockBody(msg.externalId, msg.payload.stock),
            };
            result.updatePrice = {
                endpoint: 'POST /product/update_price',
                body: this.buildShopeePriceBody(msg.externalId, msg.payload.price),
            };
        }
        return result;
    }

    private previewMercadoLivre(msg: MarketplaceSyncPayload): Record<string, any> {
        const result: Record<string, any> = {};

        if (msg.action === 'CREATE') {
            result.createItem = {
                endpoint: 'POST /items',
                body: this.buildMercadoLivreCreateBody(msg),
            };
            result.updateDescription = {
                endpoint: 'PUT /items/{externalId}/description',
                body: this.buildMercadoLivreDescriptionBody(msg.payload.description),
            };
        } else if (msg.action === 'DELETE') {
            result.closeItem = {
                endpoint: 'PUT /items/{externalId}',
                body: { status: 'closed' },
            };
        } else if (msg.action === 'UPDATE') {
            result.updateOperational = {
                endpoint: `PUT /items/${msg.externalId}`,
                body: this.buildMercadoLivreOperationalBody(msg),
            };
            result.updateContent = {
                endpoint: `PUT /items/${msg.externalId}`,
                body: this.buildMercadoLivreContentBody(msg),
            };
            result.updateDescription = {
                endpoint: `PUT /items/${msg.externalId}/description`,
                body: this.buildMercadoLivreDescriptionBody(msg.payload.description),
            };
        }
        return result;
    }

    private previewTikTokShop(msg: MarketplaceSyncPayload): Record<string, any> {
        const placeholderUris = msg.payload.images?.map(url => `<upload_required: ${url}>`) || [];
        const result: Record<string, any> = {};

        if (msg.action === 'CREATE') {
            result.createProduct = {
                endpoint: 'POST /product/202309/products',
                body: this.buildTikTokShopCreateBody(msg, placeholderUris),
            };
        } else if (msg.action === 'DELETE') {
            result.deactivateProduct = {
                endpoint: 'POST /product/202309/products/deactivate',
                body: this.buildTikTokShopDeleteBody(msg.externalId),
            };
        } else if (msg.action === 'UPDATE') {
            result.updateContent = {
                endpoint: `PUT /product/202309/products/${msg.externalId}`,
                body: this.buildTikTokShopUpdateContentBody(msg, placeholderUris),
            };
            result.updateInventory = {
                endpoint: 'POST /product/202309/products/inventory/update',
                body: this.buildTikTokShopInventoryBody(msg.externalId, msg.payload.stock),
            };
            result.updatePrice = {
                endpoint: 'PUT /product/202309/products/prices',
                body: this.buildTikTokShopPriceBody(msg.externalId, msg.payload.price),
            };
        }
        return result;
    }

    private previewOLX(msg: MarketplaceSyncPayload): Record<string, any> {
        const result: Record<string, any> = {};
        const accessToken = '<<REDACTED>>';

        if (msg.action === 'CREATE') {
            result.importAd = {
                endpoint: 'PUT https://apps.olx.com.br/autoupload/import',
                body: this.buildOLXImportBody(msg, accessToken),
            };
        } else if (msg.action === 'UPDATE') {
            result.importAd = {
                endpoint: 'PUT https://apps.olx.com.br/autoupload/import',
                body: this.buildOLXImportBody(msg, accessToken),
            };
        } else if (msg.action === 'DELETE') {
            result.deleteAd = {
                endpoint: `DELETE https://apps.olx.com.br/api/ads/${msg.externalId}`,
                note: 'access_token sent in request body',
            };
        }
        return result;
    }

    // ================================================================
    //  AMAZON  —  public builders
    // ================================================================

    buildAmazonSpApiPayload(msg: MarketplaceSyncPayload): any {
        const { payload, product } = msg;

        const brandValue = 'Generic';

        const attrProductType = payload.attributes?.find(
            (a: any) => a.id === 'amazon_product_type' || a.id === 'AMAZON_PRODUCT_TYPE'
        )?.value;
        const productAttrType = (product as any)?.attributes?.find(
            (a: any) => a.code === 'amazon_product_type'
        )?.value;
        const productType = attrProductType || productAttrType || (product as any)?.amazonProductType || 'AUTO_PART';

        const dimensions = payload.dimensions;
        const weightKg = dimensions?.weight ? dimensions.weight / 1000 : 0.5;

        const attrBulletPoint = payload.attributes?.find(
            (a: any) => a.id === 'bullet_point'
        )?.value;
        const bulletPoint = (
            attrBulletPoint ||
            (product as any)?.shortDescription ||
            payload.description ||
            payload.title ||
            'Peça de reposição de qualidade'
        ).substring(0, 500);

        const attrKeyword = payload.attributes?.find(
            (a: any) => a.id === 'generic_keyword'
        )?.value;
        const genericKeyword = (attrKeyword || payload.title || 'Peças Automotivas').substring(0, 200);

        const attrBrowseNode = payload.attributes?.find(
            (a: any) => a.id === 'recommended_browse_nodes'
        )?.value;
        const browseNode = attrBrowseNode || '17122858011';

        const attributes: any = {
            item_name: [{ value: payload.title, language_tag: 'pt_BR' }],
            brand: [{ value: brandValue }],
            manufacturer: [{ value: brandValue }],
            part_number: [{ value: String(product?.partNumber || payload.sku) }],
            model_name: [{ value: String(product?.partNumber || payload.sku) }],
            bullet_point: [{ value: bulletPoint, language_tag: 'pt_BR' }],
            product_description: [{ value: (payload.description || payload.title || '').substring(0, 2000), language_tag: 'pt_BR' }],
            country_of_origin: [{ value: 'BR' }],
            supplier_declared_dg_hz_regulation: [{ value: 'not_applicable' }],
            external_testing_certification: [{ value: 'Not Applicable' }],
            required_product_compliance_certificate: [{ value: 'Not Applicable' }],
            generic_keyword: [{ value: genericKeyword, language_tag: 'pt_BR' }],
            recommended_browse_nodes: [{ value: browseNode }],
            is_assembly_required: [{ value: false }],
            warranty_description: [{ value: product?.warranty?.description || 'Garantia do Fabricante: 3 meses contra defeitos de fabricação.', language_tag: 'pt_BR' }],
            power_source_type: [{ value: 'air_powered' }],
            automotive_fit_type: [{ value: 'universal_fit' }],
            item_package_dimensions: [{
                length: { value: Number(dimensions?.length || 20), unit: 'centimeters' },
                width: { value: Number(dimensions?.width || 20), unit: 'centimeters' },
                height: { value: Number(dimensions?.height || 10), unit: 'centimeters' },
            }],
            item_package_weight: [{ value: weightKg, unit: 'kilograms' }],
            number_of_boxes: [{ value: 1 }],
            contains_liquid_contents: [{ value: false }],
            included_components: [{ value: '1 Peça', language_tag: 'pt_BR' }],
            purchasable_offer: [{
                currency: 'BRL',
                our_price: [{
                    schedule: [{
                        value_with_tax: payload.price,
                        start_at: new Date().toISOString(),
                    }],
                }],
            }],
            list_price: [{ value_with_tax: payload.price, currency: 'BRL' }],
            fulfillment_availability: [{
                fulfillment_channel_code: 'DEFAULT',
                quantity: Math.floor(Number(payload.stock || 0)),
                lead_time_to_ship_max_days: 2,
            }],
            supplier_declared_has_product_identifier_exemption: [{ value: true }],
        };

        if (payload.images?.length > 0) {
            attributes.main_product_image_locator = [{ media_location: payload.images[0] }];
            payload.images.slice(1, 4).forEach((url, idx) => {
                attributes[`other_product_image_locator_${idx + 1}`] = [{ media_location: url }];
            });
        }

        const HANDLED_ATTR_IDS = new Set([
            'amazon_product_type', 'AMAZON_PRODUCT_TYPE',
            'bullet_point', 'generic_keyword', 'recommended_browse_nodes',
            'category_id',
        ]);
        if (Array.isArray(payload.attributes)) {
            for (const attr of payload.attributes) {
                if (!attr.id || HANDLED_ATTR_IDS.has(attr.id) || attr.value == null) continue;
                const spValue = typeof attr.value === 'string'
                    ? [{ value: attr.value, language_tag: 'pt_BR' }]
                    : [{ value: attr.value }];
                attributes[attr.id] = spValue;
            }
        }

        return {
            productType,
            requirements: 'LISTING',
            attributes,
        };
    }

    // ================================================================
    //  SHOPEE  —  public builders
    // ================================================================

    buildShopeeCommonFields(payload: MarketplaceSyncPayload['payload'], imageIds: string[]): any {
        const dims = payload.dimensions;
        return {
            item_name: payload.title,
            description: payload.description,
            item_sku: payload.sku,
            original_price: payload.price,
            normal_stock: payload.stock,
            seller_stock: [{ stock: payload.stock }],
            weight: Number(dims?.weight || 0.5),
            dimension: {
                package_length: Number(dims?.length || 20),
                package_width: Number(dims?.width || 20),
                package_height: Number(dims?.height || 10),
            },
            brand: { brand_id: 0, original_brand_name: payload.brand || 'NoBrand' },
            image: imageIds.length > 0 ? { image_id_list: imageIds } : undefined,
        };
    }

    buildShopeeCreateBody(msg: MarketplaceSyncPayload, imageIds: string[], logisticInfo: any[]): any {
        const common = this.buildShopeeCommonFields(msg.payload, imageIds);
        const categoryId = this.extractShopeeCategoryId(msg.payload.attributes);
        return {
            ...common,
            category_id: Number(categoryId),
            logistic_info: logisticInfo,
            tax_info: {
                ncm: '87089990',
                same_state_cfop: '5102',
                diff_state_cfop: '6108',
                csosn: '',
                origin: '0',
                cest: '0199900',
                measure_unit: 'UN',
            },
        };
    }

    buildShopeeUpdateItemBody(msg: MarketplaceSyncPayload, imageIds: string[]): any {
        const common = this.buildShopeeCommonFields(msg.payload, imageIds);
        return { item_id: Number(msg.externalId), ...common };
    }

    buildShopeeStockBody(itemId: string | number, stock: number): any {
        return {
            item_id: Number(itemId),
            stock_list: [{ model_id: 0, seller_stock: [{ stock }] }],
        };
    }

    buildShopeePriceBody(itemId: string | number, price: number): any {
        return {
            item_id: Number(itemId),
            price_list: [{ original_price: price }],
        };
    }

    buildShopeeDeleteBody(externalId: string): any {
        return {
            item_list: [{ item_id: Number(externalId), unlist: true }],
        };
    }

    extractShopeeCategoryId(attrs: any[]): string {
        const cat = attrs?.find(a => a.id === 'category_id');
        const val = cat ? cat.value : null;
        if (val && /^\d+$/.test(String(val)) && String(val) !== '0') return String(val);
        this.logger.warn(`[Shopee] Invalid or missing category_id (${val}). Using default 102284.`);
        return '102284';
    }

    // ================================================================
    //  MERCADO LIVRE  —  public builders
    // ================================================================

    buildMercadoLivreCreateBody(msg: MarketplaceSyncPayload): any {
        return {
            family_name: msg.payload.title,
            category_id: this.extractMLCategoryId(msg.payload.attributes),
            price: msg.payload.price,
            currency_id: 'BRL',
            available_quantity: msg.payload.stock,
            buying_mode: 'buy_it_now',
            condition: 'new',
            listing_type_id: 'gold_pro',
            seller_custom_field: msg.payload.sku,
            description: { plain_text: msg.payload.description },
            pictures: msg.payload.images.map(url => ({ source: url })),
            attributes: this.mapMLAttributes(msg.payload.attributes),
        };
    }

    buildMercadoLivreOperationalBody(msg: MarketplaceSyncPayload): Record<string, any> {
        const body: Record<string, any> = {};
        if (msg.payload.price !== undefined && msg.payload.price > 0) body.price = msg.payload.price;
        if (msg.payload.stock !== undefined) body.available_quantity = msg.payload.stock;
        return body;
    }

    buildMercadoLivreContentBody(msg: MarketplaceSyncPayload): any {
        return {
            pictures: msg.payload.images.map(url => ({ source: url })),
            attributes: this.mapMLAttributes(msg.payload.attributes),
        };
    }

    buildMercadoLivreDescriptionBody(description: string): any {
        return { plain_text: description };
    }

    extractMLCategoryId(attrs: any[]): string {
        const cat = attrs?.find(a => a.id === 'category_id');
        return cat ? cat.value : 'MLB3530';
    }

    mapMLAttributes(attrs: any[]): any[] {
        if (!Array.isArray(attrs)) {
            this.logger.warn('Attributes is not an array, falling back to empty list');
            return [];
        }

        return attrs
            .filter(a => a.id !== 'category_id')
            .map(attr => {
                const out: any = { id: attr.id };

                if (attr.valueType === 'list') {
                    out.value_id = attr.value;
                } else if (attr.valueType === 'boolean') {
                    out.value_name = (String(attr.value) === 'true' || attr.value === true) ? 'Sim' : 'Não';
                } else if (attr.valueType === 'string') {
                    out.value_name = attr.valueName ? String(attr.valueName) : String(attr.value);
                } else {
                    out.value_name = attr.valueName ? String(attr.valueName) : String(attr.value);
                }

                return out;
            });
    }

    // ================================================================
    //  TIKTOK SHOP  —  public builders
    // ================================================================

    buildTikTokShopCreateBody(msg: MarketplaceSyncPayload, imageUris: string[]): any {
        const { payload } = msg;
        const categoryId = this.extractTikTokCategoryId(payload.attributes);

        const body: any = {
            title: (payload.title || '').slice(0, 255),
            description: payload.description || '',
            category_id: categoryId,
            main_images: imageUris.map(uri => ({ uri })),
            skus: [{
                seller_sku: payload.sku || '',
                price: {
                    amount: String(Math.round((payload.price || 0) * 100)),
                    currency: 'BRL',
                },
                inventory: [{
                    warehouse_id: process.env.TIKTOK_SHOP_WAREHOUSE_ID || '0',
                    quantity: payload.stock || 0,
                }],
            }],
            package_dimensions: {
                length: String(payload.dimensions?.length || 20),
                width: String(payload.dimensions?.width || 20),
                height: String(payload.dimensions?.height || 10),
                weight: String(payload.dimensions?.weight || 0.5),
                unit: 'METRIC',
            },
            is_cod_allowed: false,
        };

        if (payload.brand) {
            body.brand = { name: payload.brand };
        }

        return body;
    }

    buildTikTokShopUpdateContentBody(msg: MarketplaceSyncPayload, imageUris: string[]): any {
        const { payload } = msg;
        const body: any = {
            title: (payload.title || '').slice(0, 255),
            description: payload.description || '',
        };

        if (imageUris.length > 0) {
            body.main_images = imageUris.map(uri => ({ uri }));
        }

        if (payload.dimensions) {
            body.package_dimensions = {
                length: String(payload.dimensions.length || 20),
                width: String(payload.dimensions.width || 20),
                height: String(payload.dimensions.height || 10),
                weight: String(payload.dimensions.weight || 0.5),
                unit: 'METRIC',
            };
        }

        return body;
    }

    buildTikTokShopInventoryBody(productId: string, stock: number): any {
        return {
            product_id: productId,
            skus: [{
                id: '0',
                inventory: [{
                    warehouse_id: process.env.TIKTOK_SHOP_WAREHOUSE_ID || '0',
                    quantity: stock || 0,
                }],
            }],
        };
    }

    buildTikTokShopPriceBody(productId: string, price: number): any {
        return {
            product_id: productId,
            skus: [{
                id: '0',
                price: {
                    amount: String(Math.round((price || 0) * 100)),
                    currency: 'BRL',
                },
            }],
        };
    }

    buildTikTokShopDeleteBody(externalId: string): any {
        return { product_ids: [externalId] };
    }

    extractTikTokCategoryId(attrs: any[]): string {
        if (!attrs) return process.env.TIKTOK_SHOP_DEFAULT_CATEGORY_ID || '0';
        const cat = attrs.find((a: any) => a.id === 'category_id');
        const val = cat ? cat.value : null;
        if (val && String(val) !== '0') return String(val);
        this.logger.warn(`[TikTok Shop] Invalid or missing category_id (${val}). Using default.`);
        return process.env.TIKTOK_SHOP_DEFAULT_CATEGORY_ID || '0';
    }

    // ================================================================
    //  OLX  —  public builders
    // ================================================================

    buildOLXImportBody(msg: MarketplaceSyncPayload, accessToken: string): any {
        const { payload } = msg;
        const categoryId = this.extractOLXCategoryId(payload.attributes);
        const adId = msg.externalId || `SKU_${payload.sku}`;
        const operation = msg.externalId ? 'update' : 'insert';

        return {
            access_token: accessToken,
            ad_list: [{
                id: adId,
                operation,
                category: categoryId,
                subject: (payload.title || '').slice(0, 90),
                body: payload.description || '',
                params: { condition: '1' },
                phone: (() => {
                    const phone = Number(process.env.OLX_PHONE || '0');
                    if (!phone) this.logger.warn('[OLX] OLX_PHONE env var not set — ad will have phone=0 and may be rejected by OLX API');
                    return phone;
                })(),
                type: 's',
                price: payload.price,
                zipcode: process.env.OLX_ZIPCODE || '01310100',
                phone_hidden: true,
                images: (payload.images || []).slice(0, 20),
            }],
        };
    }

    buildOLXDeleteBody(_externalId: string, accessToken: string): any {
        return { access_token: accessToken };
    }

    extractOLXCategoryId(attrs: any[]): number {
        const cat = attrs?.find(a => a.id === 'category_id' || a.id === 'olx_category_id');
        const val = cat ? Number(cat.value) : 0;
        if (val > 0) return val;
        this.logger.warn(`[OLX] Invalid or missing category_id (${val}). Using default 2101 (Peças Automotivas).`);
        return 2101; // Default: Peças Automotivas (OLX category)
    }
}
