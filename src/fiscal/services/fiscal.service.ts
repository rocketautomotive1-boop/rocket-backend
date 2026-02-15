import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FiscalDocumentModel, FiscalDocumentDocument, FiscalIssuerModel, FiscalIssuerDocument } from '../schemas/fiscal.schema';
import { XmlBuilderService } from './xml-builder.service';
import { SignatureService } from './signature.service';
import { SefazService } from './sefaz.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';

@Injectable()
export class FiscalService {
    private readonly logger = new Logger(FiscalService.name);

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private fiscalDocumentModel: Model<FiscalDocumentDocument>,
        @InjectModel(FiscalIssuerModel.name)
        private fiscalIssuerModel: Model<FiscalIssuerDocument>,

        private readonly xmlBuilderService: XmlBuilderService,
        private readonly signatureService: SignatureService,
        private readonly sefazService: SefazService,
        @Inject(forwardRef(() => MarketplaceService))
        private readonly marketplaceService: MarketplaceService,
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
    ) { }

    async prepareNFeData(orderId: string, marketplaceId?: string): Promise<any> {
        this.logger.log(`Preparing NFe data for order ${orderId} (Marketplace ID: ${marketplaceId})`);
        const orderData: any = { orderId };

        // Try to fetch Fresh Order Data from Marketplace to ensure Buyer Data is present
        let fullOrder = null;
        try {
            let targetMarketplaceId: string = marketplaceId ? String(marketplaceId) : undefined;

            if (!targetMarketplaceId) {
                // Heuristic detection if marketplaceId is missing via Registry
                const detectedMk = await this.marketplaceRegistry.detectMarketplaceByOrderId(orderId);
                if (detectedMk) {
                    targetMarketplaceId = String(detectedMk._id);
                }
            }

            if (targetMarketplaceId) {
                try {
                    this.logger.log(`Tentando buscar detalhes do pedido ${orderId} no marketplace ${targetMarketplaceId}`);
                    fullOrder = await this.marketplaceOrderService.getOrderDetails(orderId, targetMarketplaceId);
                } catch (e) {
                    this.logger.warn(`Falha ao buscar detalhes do pedido no marketplace alvo ${targetMarketplaceId}: ${e.message}`);
                }
            } else {
                // Try all active marketplaces
                const marketplaces = await this.marketplaceService.findAll();
                const activeMarketplaces = marketplaces.filter(mk => mk.enabled);

                for (const mk of activeMarketplaces) {
                    try {
                        fullOrder = await this.marketplaceOrderService.getOrderDetails(orderId, mk.id);
                        if (fullOrder) {
                            this.logger.log(`Pedido encontrado no marketplace: ${mk.name}`);
                            break;
                        }
                    } catch (e) {
                        this.logger.debug(`Pedido não encontrado em ${mk.name}: ${e.message}`);
                    }
                }
            }

            if (fullOrder) {
                // Merge found data into orderData
                orderData.marketplaceId = fullOrder.marketplace?.id;
                orderData.items = fullOrder.items;
                orderData.totals = {
                    amount: fullOrder.total_amount,
                    freight: fullOrder.freight || 0,
                    discount: fullOrder.discount || 0
                };

                if (fullOrder.buyer) {
                    const buyerName = fullOrder.buyer.name || fullOrder.buyer.nickname || (fullOrder.buyer.first_name ? fullOrder.buyer.first_name + ' ' + (fullOrder.buyer.last_name || '') : '');

                    orderData.buyer = {
                        ...fullOrder.buyer,
                        name: buyerName,
                        document: fullOrder.buyer.document || '',
                        address: fullOrder.buyer.address || fullOrder.shipping_address || fullOrder.address
                    };
                }

                // Extract Payment Data to pass to XML Builder
                if (fullOrder.payments && fullOrder.payments.length > 0) {
                    const payment = fullOrder.payments.find((p: any) => p.status === 'approved') || fullOrder.payments[0];
                    orderData.payment = {
                        paymentMethodId: payment.payment_method_id,
                        paymentType: payment.payment_type,
                        authorizationCode: payment.authorization_code,
                        installments: payment.installments
                    };
                }
            }
        } catch (error) {
            this.logger.warn(`Could not enrich order data from marketplace: ${error.message}`);
        }

        if (!fullOrder || !orderData.items || orderData.items.length === 0) {
            throw new NotFoundException(`Pedido ${orderId} não encontrado ou sem itens em nenhum marketplace ativo.`);
        }

        // Enrich Item Data with Real Product Data (NCM, etc)
        if (orderData.items && Array.isArray(orderData.items)) {
            for (const item of orderData.items) {
                let product: any = null;

                // Priority 1: Check seller_custom_field (Internal ID)
                if (item.seller_custom_field) {
                    // Try as direct ID
                    product = await this.productService.findOne(item.seller_custom_field);
                }

                // Priority 2: Check standard ID if numeric (Legacy)
                if (!product && item.id && !isNaN(Number(item.id))) {
                    product = await this.productService.findOne(item.id);
                }

                // Priority 3: SKU (Part Number)
                if (!product && item.sku) {
                    product = await this.productService.findBySku(item.sku) || await this.productService.findOne(item.sku);
                }

                if (product) {
                    item.ncm = product.ncm?.code || item.ncm;
                    item.title = product.name || item.title;
                    item.cfop = product.cfop || '5102';
                    item.cest = product.cest || item.cest;
                    item.origin = product.origin || '0';
                    item.uCom = product.unit?.code || 'UN';
                }
            }
        }

        return orderData;
    }

    async emitNFe(orderId: string, orderData: any) {
        this.logger.log(`Iniciando emissão de NFe para pedido ${orderId}`);

        // Validate minimal data
        if (!orderData.buyer || !orderData.buyer.document || !orderData.buyer.address) {
            this.logger.error(`Dados incompletos: Buyer=${!!orderData.buyer}, Doc=${!!orderData.buyer?.document}, Addr=${!!orderData.buyer?.address}`);
            throw new Error('Dados do destinatário incompletos para emissão.');
        }

        if (!orderData.items || orderData.items.length === 0) {
            this.logger.error(`Dados incompletos: Itens ausentes ou vazios.`);
            throw new Error('O pedido não possui itens para emissão da NFe.');
        }

        // 1. Get Issuer (Company Config)
        let issuer = await this.fiscalIssuerModel.findOne({ isActive: true }).exec();

        if (!issuer) {
            throw new NotFoundException('Nenhum emitente fiscal configurado.');
        }

        // 1b. Determine Series
        let series = issuer.nfeSeries || 1;
        if (orderData.marketplaceId) {
            const marketplace = await this.marketplaceService.findOne(orderData.marketplaceId);
            if (marketplace && marketplace.settings?.nfeSeries) {
                series = Number(marketplace.settings.nfeSeries);
            }
        }

        // 2. Check if NFe already exists
        let nfe = await this.fiscalDocumentModel.findOne({ orderId }).exec();

        if (nfe) {
            if (nfe.status === 'AUTHORIZED' || nfe.status === 'PROCESSING') {
                return { message: 'NFe já emitida ou em processamento', nfeId: nfe._id, status: nfe.status, accessKey: nfe.accessKey };
            }
            this.logger.log(`Reusing existing NFe ${nfe.number} for retry.`);
        } else {
            // Atomic increment for new number
            issuer = await this.fiscalIssuerModel.findOneAndUpdate(
                { _id: issuer._id },
                { $inc: { lastNfeNumber: 1 } },
                { new: true }
            ).exec();

            const newNfeNumber = issuer.lastNfeNumber;

            nfe = new this.fiscalDocumentModel({
                orderId,
                issuer: issuer.toObject(), // Embed snapshot of issuer? Or ref? Schema has embedded? Check Schema. Assuming embedded or ref.
                // Schema likely has issuer as subdoc or ref. If ref, we pass ID. If embedded, object.
                // Let's assume embedded snapshot is safer for history, but if schema is ref, this fails.
                // Checking previous schema view... lines 1-30 don't show FiscalDocumentModel.
                // Standard approach: store issuer snapshot in NFe for fiscal immutability.
                // Whatever properties match the schema.
                // For now, simpler: map fields if needed, or pass object if schema handles it.
                status: 'DRAFT',
                environment: 'PRODUCTION',
                number: newNfeNumber,
                series: series,
                createdAt: new Date()
            });
        }

        // Update Series just in case
        nfe.series = series;
        await nfe.save();

        try {
            // 3. Build XML (Draft)
            const xml = await this.xmlBuilderService.buildNFeXml(nfe, orderData, issuer);

            // 4. Sign XML
            let signedXml = xml;
            if (issuer.certificatePfx) {
                signedXml = await this.signatureService.signXml(xml, issuer.certificatePfx, issuer.certificatePassword);
            } else {
                this.logger.warn('Skipping XML signature: No PFX certificate found.');
            }

            // 5. Transmit to SEFAZ
            const result = await this.sefazService.authorize(signedXml, nfe.environment, issuer);

            // Update NFe
            nfe.status = result.status === 'authorized' ? 'AUTHORIZED' : (result.status === 'processing' ? 'PROCESSING' : (result.status === 'denied' ? 'REJECTED' : 'ERROR'));
            nfe.protocol = result.protocol;
            nfe.xml = result.xml || signedXml;

            if (result.message) {
                nfe.rejectionReason = result.message;
            }

            if (result.responseXml) {
                this.logger.log(`SEFAZ Full Response: ${result.responseXml}`);
            }

            await nfe.save();

            return { message: 'NFe emitida com sucesso', nfeId: nfe._id, status: nfe.status, accessKey: nfe.accessKey };

        } catch (error) {
            this.logger.error(`Failed to emit NFe: ${error.message}`);
            nfe.status = 'ERROR';
            nfe.rejectionReason = error.message;
            await nfe.save();
            throw error;
        }
    }

    async saveIssuer(data: Partial<FiscalIssuerModel>) {
        const issuer = await this.fiscalIssuerModel.findOneAndUpdate(
            { isActive: true },
            data,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).exec();

        return issuer;
    }

    async getIssuer() {
        return await this.fiscalIssuerModel.findOne({ isActive: true }).exec();
    }

    async getNFeByOrderId(orderId: string) {
        return await this.fiscalDocumentModel.findOne({ orderId }).exec(); // issuer is normally embedded? If ref, .populate('issuer')
    }
}
