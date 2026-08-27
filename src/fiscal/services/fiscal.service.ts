import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalDocumentModel, FiscalDocumentDocument, FiscalInutilizationModel, FiscalInutilizationDocument } from '../schemas/fiscal.schema';
import { XmlBuilderService } from './xml-builder.service';
import { SignatureService } from './signature.service';
import { SefazService } from './sefaz.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { OrderModel, OrderDocument } from '../../order/schemas/order.schema';
import { STORE_PORT, StorePort } from '../../store/ports/store.port';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { FiscalCustomerService } from '../../fiscal-customer/services/fiscal-customer.service';
import { mapMarketplacePayments, enrichItemWithProductData } from './fiscal-nfe-data.helpers';
import {
    FISCAL_EVENTS,
    FiscalNfeAuthorizedEvent,
    FiscalNfeRejectedEvent,
    FiscalNfeErrorEvent,
    FiscalNfeCancelledEvent,
} from '../events/fiscal.events';

@Injectable()
export class FiscalService {
    private readonly logger = new Logger(FiscalService.name);

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private fiscalDocumentModel: Model<FiscalDocumentDocument>,
        @InjectModel(FiscalInutilizationModel.name)
        private fiscalInutilizationModel: Model<FiscalInutilizationDocument>,
        @InjectModel(OrderModel.name)
        private orderModel: Model<OrderDocument>,

        private readonly xmlBuilderService: XmlBuilderService,
        private readonly signatureService: SignatureService,
        private readonly sefazService: SefazService,
        private readonly marketplaceService: MarketplaceService,
        private readonly productService: ProductService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        @Inject(STORE_PORT)
        private readonly storePort: StorePort,
        private readonly legalEntityService: LegalEntityService,
        private readonly eventEmitter: EventEmitter2,
        private readonly fiscalCustomerService: FiscalCustomerService,
    ) { }

    /** Resolve Store → LegalEntity + FiscalChannel para a conta que recebeu o pedido. */
    private async resolveFiscalContext(marketplaceTag: string | undefined, accountId: string | undefined) {
        if (!marketplaceTag || !accountId) {
            throw new BadRequestException('Pedido sem marketplaceTag/accountId — não é possível resolver a loja emissora.');
        }
        const store = await this.storePort.resolveStoreForAccount(marketplaceTag, accountId);
        if (!store) {
            throw new NotFoundException(`Nenhuma loja vinculada à conta ${marketplaceTag}/${accountId}.`);
        }
        const legalEntity = await this.legalEntityService.findById(store.legalEntityId);
        const channel = await this.storePort.resolveFiscalChannel(store.id, marketplaceTag, accountId);
        if (!channel) {
            throw new NotFoundException(
                `Loja ${store.name} não tem canal fiscal configurado para ${marketplaceTag}/${accountId}.`,
            );
        }
        return { store, legalEntity, channel };
    }

    async prepareNFeData(orderId: string, marketplaceId?: string): Promise<any> {
        this.logger.log(`Preparing NFe data for order ${orderId}`);

        // ── Step 1: Load the stored order from DB first ───────────────────────
        // orderId may be a MongoDB ObjectId (24-char hex) or a marketplace externalId (numeric string).
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(orderId);
        let dbOrder: any = null;
        if (isObjectId) {
            dbOrder = await this.orderModel.findById(orderId).populate('fiscalDocuments').lean().exec();
        }
        if (!dbOrder) {
            // Fallback: search by externalId (marketplace order number like "155897305276281")
            dbOrder = await this.orderModel.findOne({ externalId: orderId }).populate('fiscalDocuments').lean().exec();
        }
        if (!dbOrder) {
            throw new NotFoundException(`Pedido ${orderId} não encontrado no banco de dados.`);
        }

        const externalId = dbOrder.externalId as string;
        const resolvedMarketplaceId = marketplaceId
            ? String(marketplaceId)
            : dbOrder.marketplaceId
                ? String(dbOrder.marketplaceId)
                : undefined;

        this.logger.log(`Order resolved: externalId=${externalId}, marketplaceId=${resolvedMarketplaceId}`);

        // ── Step 2: Pre-populate from stored data (always-available fallback) ─
        // Resolve marketplace name for XML infIntermed
        let marketplaceName: string | undefined;
        if (resolvedMarketplaceId) {
            try {
                const mp = await this.marketplaceService.findOne(resolvedMarketplaceId);
                marketplaceName = mp?.name || mp?.type || undefined;
            } catch { /* non-critical */ }
        }

        const orderData: any = {
            orderId,
            marketplaceId: resolvedMarketplaceId,
            marketplaceTag: dbOrder.marketplaceTag,
            accountId: dbOrder.accountId,
            marketplaceName,
            items: (dbOrder.items || []).map((i: any) => ({
                id: i.externalId,
                sku: i.externalId,
                title: i.title,
                quantity: i.quantity,
                unit_price: i.unitPrice,
                seller_custom_field: i.productId ? String(i.productId) : undefined,
            })),
            totals: {
                amount: dbOrder.totalAmount || 0,
                freight: dbOrder.shippingAmount || 0,
                discount: 0,
            },
        };

        // Use stored customer as fallback buyer
        if (dbOrder.customer?.name) {
            orderData.buyer = {
                name: dbOrder.customer.name,
                document: dbOrder.customer.document || '',
                email: dbOrder.customer.email || '',
                phone: dbOrder.customer.phone || '',
                address: dbOrder.customer.address || {},
            };
        }

        // ── Step 3: Enrich from marketplace using the correct externalId ──────
        if (externalId && resolvedMarketplaceId) {
            try {
                this.logger.log(`Enriching NFe data from marketplace for externalId=${externalId}`);
                const fullOrder = await this.marketplaceOrderService.getOrderDetails(externalId, resolvedMarketplaceId);

                if (fullOrder) {
                    // Override items with fresh marketplace data
                    if (fullOrder.items?.length) {
                        orderData.items = fullOrder.items;
                    }

                    orderData.totals = {
                        amount: fullOrder.total_amount || orderData.totals.amount,
                        freight: fullOrder.shipping?.cost || (fullOrder as any).freight || orderData.totals.freight,
                        discount: fullOrder.couponAmount || 0,
                    };

                    if (fullOrder.buyer) {
                        const buyerName = fullOrder.buyer.name
                            || (fullOrder.buyer.first_name ? `${fullOrder.buyer.first_name} ${fullOrder.buyer.last_name || ''}`.trim() : '')
                            || fullOrder.buyer.nickname
                            || orderData.buyer?.name
                            || '';

                        // Um endereço do marketplace sem CEP não conta como "presente": os adapters
                        // (ex.: MercadoLivreOrderAdapter) sempre retornam um objeto com todas as
                        // chaves, mesmo vazias, quando o shipment não tem receiver_address.zip_code —
                        // um "||" simples nunca cairia no fallback e apagava o CEP já persistido em
                        // dbOrder.customer.address (aquele que a modal de emissão e o card do
                        // comprador no app já mostram corretos). E quando o marketplace TEM o CEP,
                        // ele vem na chave zip_code (snake_case) — normaliza pra zipCode aqui, já
                        // que XmlBuilderService.requireBuyerAddress só reconhece zipCode (camelCase);
                        // sem isso, um endereço válido do marketplace ainda rejeitava a NFe com
                        // "faltando zipCode" mesmo com o CEP presente no payload.
                        const normalizeAddress = (a: any): any | undefined => {
                            const zipCode = a?.zip_code || a?.zipCode;
                            return zipCode ? { ...a, zipCode } : undefined;
                        };
                        const mpAddress = normalizeAddress(fullOrder.buyer.address);
                        const shippingAddress = normalizeAddress((fullOrder as any).shipping_address);

                        orderData.buyer = {
                            ...fullOrder.buyer,
                            name: buyerName,
                            document: fullOrder.buyer.document || orderData.buyer?.document || '',
                            address: mpAddress || shippingAddress || orderData.buyer?.address || {},
                        };
                    }

                    if (fullOrder.payments?.length) {
                        const approvedPayments = mapMarketplacePayments(fullOrder.payments);
                        orderData.payments = approvedPayments;
                        // Compat: orderData.payment singular ainda alimenta callers antigos
                        // (ex.: modalOverrides parcial no admin) — primeiro pagamento aprovado.
                        if (approvedPayments.length) {
                            orderData.payment = approvedPayments[0];
                        }
                    }
                }
            } catch (e) {
                this.logger.warn(`Could not enrich NFe data from marketplace (using stored data): ${e.message}`);
            }
        }

        // ── Step 3b: Resolve FiscalCustomer — dados de um cadastro já confirmado
        // por um humano têm precedência sobre o que veio do marketplace. Não
        // sobrescreve nada aqui, só enriquece — o modal de emissão confirma. ──
        if (orderData.buyer?.document) {
            try {
                const fiscalCustomer = await this.fiscalCustomerService.findByDocument(orderData.buyer.document);
                if (fiscalCustomer) {
                    const primaryAddress = fiscalCustomer.addresses?.[0];
                    orderData.buyer = {
                        ...orderData.buyer,
                        name: fiscalCustomer.name || orderData.buyer.name,
                        email: fiscalCustomer.email || orderData.buyer.email,
                        phone: fiscalCustomer.phone || orderData.buyer.phone,
                        ie: fiscalCustomer.ie,
                        ieIndicator: fiscalCustomer.ieIndicator,
                        address: primaryAddress || orderData.buyer.address,
                    };
                }
            } catch (e) {
                this.logger.warn(`Could not resolve FiscalCustomer for document ${orderData.buyer.document}: ${e.message}`);
            }
        }

        // ── Step 4: Validate minimum required data ────────────────────────────
        if (!orderData.items || orderData.items.length === 0) {
            throw new NotFoundException(`Pedido ${orderId} não possui itens para emissão da NFe.`);
        }

        // Enrich Item Data with Real Product Data (NCM, etc)
        const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
        if (orderData.items && Array.isArray(orderData.items)) {
            for (const item of orderData.items) {
                let product: any = null;

                // Priority 1: seller_custom_field = MongoDB productId (must be a valid ObjectId)
                // Marketplace IDs (numeric strings like "155897305276281") are never valid here.
                if (item.seller_custom_field && IS_MONGO_ID.test(String(item.seller_custom_field))) {
                    try { product = await this.productService.findOne(item.seller_custom_field); } catch { }
                }

                // Priority 2 (removed): numeric ID lookup was catching marketplace line-item IDs,
                // causing "Invalid ID format" via @ValidateMongoId. Internal product IDs are always ObjectIds.

                // Priority 3: seller SKU may be the product ObjectId (Amazon sets SellerSKU = product._id)
                if (!product && item.sku && IS_MONGO_ID.test(String(item.sku))) {
                    try { product = await this.productService.findOne(item.sku); } catch { }
                }

                if (product) {
                    item.ncm = product.ncm?.code || item.ncm;
                    item.title = product.name || item.title;
                    // Sem fallback fixo aqui: CFOP depende de a operação ser interna/interestadual
                    // (calculado só em XmlBuilderService, que tem o endereço do destinatário).
                    // '5102' fixo nesse ponto sobrescrevia o cálculo correto — item sempre saía
                    // como venda interna mesmo em operação interestadual, rejeitado pela SEFAZ.
                    item.cfop = product.cfop || item.cfop;
                    item.cest = product.cest || item.cest;
                    item.origin = product.origin || '0';
                    item.uCom = product.unit?.code || 'UN';
                    enrichItemWithProductData(item, product);
                }
            }
        }

        return orderData;
    }

    async emitNFe(orderId: string, modalOverrides: any) {
        this.logger.log(`Iniciando emissão de NFe para pedido ${orderId}`);

        // Always fetch fresh, enriched order data (marketplace enrichment, NCM, buyer address, etc.)
        // then deep-merge the modal confirmations on top so user edits take priority.
        let orderData: any;
        try {
            const prepared = await this.prepareNFeData(orderId, modalOverrides?.marketplaceId);
            orderData = {
                ...prepared,
                ...modalOverrides,
                // Merge profundo em buyer.address — um merge raso aqui perdia zipCode/city/etc
                // sempre que o modal do app mandava um override parcial (ex.: só street/number),
                // já que address é objeto aninhado dentro de buyer e {...a,...b} não desce nível.
                // Foi exatamente essa perda que fez o ML rejeitar a NFe com CEP "00000000".
                buyer: {
                    ...prepared.buyer,
                    ...(modalOverrides?.buyer || {}),
                    address: {
                        ...(prepared.buyer?.address || {}),
                        ...(modalOverrides?.buyer?.address || {}),
                        // modalOverrides pode carregar o CEP como zip_code (snake_case, ex.: outbox
                        // salvo com o shape bruto do marketplace) — normaliza pra zipCode aqui
                        // também, senão o requireBuyerAddress do XmlBuilderService não reconhece.
                        zipCode: modalOverrides?.buyer?.address?.zipCode
                            || modalOverrides?.buyer?.address?.zip_code
                            || prepared.buyer?.address?.zipCode,
                    },
                },
                totals: { ...prepared.totals, ...(modalOverrides?.totals || {}) },
                items:  (modalOverrides?.items?.length ? modalOverrides.items : prepared.items),
            };
        } catch (prepErr) {
            this.logger.warn(`prepareNFeData falhou (${prepErr.message}); usando dados do modal como fallback`);
            orderData = modalOverrides;
        }

        // Validate minimal data
        if (!orderData?.buyer || !orderData.buyer.document || !orderData.buyer.address) {
            this.logger.error(`Dados incompletos: Buyer=${!!orderData?.buyer}, Doc=${!!orderData?.buyer?.document}, Addr=${!!orderData?.buyer?.address}`);
            throw new Error('Dados do destinatário incompletos para emissão.');
        }

        if (!orderData.items || orderData.items.length === 0) {
            this.logger.error(`Dados incompletos: Itens ausentes ou vazios.`);
            throw new Error('O pedido não possui itens para emissão da NFe.');
        }

        // 1. Check if a reusable NFe already exists for this order.
        //    Resolve both MongoDB ObjectIds and external marketplace IDs so that
        //    retries never generate a new sequence number for ERROR/DRAFT/REJECTED NFes.
        // Feito ANTES de resolveFiscalContext (que pode lançar por config ausente,
        // ex: loja sem canal fiscal) para que o catch abaixo sempre tenha um `nfe`
        // para marcar como ERROR/persistir/notificar — sem isso, um erro de
        // configuração nunca cria FiscalDocument e a modal do app fica travada
        // para sempre, já que não há nada para o catch-up ou o polling encontrarem.
        const internalOrderId = await this.resolveInternalOrderId(orderId);
        let nfe = internalOrderId
            ? await this.fiscalDocumentModel
                .findOne({
                    $or: [{ orderId: internalOrderId }, { order: internalOrderId }],
                    status: { $nin: ['CANCELLED', 'CANCELED'] },
                })
                .sort({ createdAt: -1 })
                .exec()
            : null;

        if (nfe) {
            if (nfe.status === 'AUTHORIZED' || nfe.status === 'PROCESSING') {
                return { message: 'NFe já emitida ou em processamento', nfeId: nfe._id, status: nfe.status, accessKey: nfe.accessKey };
            }
            if (nfe.status === 'CANCELLING') {
                // A cancellation is in progress — block re-emission until it resolves
                throw new Error('NFe está em processo de cancelamento. Aguarde a conclusão antes de emitir novamente.');
            }
            // DRAFT / ERROR / REJECTED — safe to retry with the same number
            this.logger.log(`Reusing existing NFe ${nfe.number} série ${nfe.series} (status: ${nfe.status}) for retry.`);
        } else {
            nfe = new this.fiscalDocumentModel({
                orderId: internalOrderId,
                order: internalOrderId,
                status: 'DRAFT',
                environment: orderData?.environment === 'HOMOLOGATION' ? 'HOMOLOGATION' : 'PRODUCTION',
                createdAt: new Date()
            });
            await nfe.save();
        }

        try {
            // 2. Resolve Store → LegalEntity + FiscalChannel (série, contador, sellerId) para a conta que recebeu o pedido.
            const { store, legalEntity, channel } = await this.resolveFiscalContext(
                orderData.marketplaceTag,
                orderData.accountId,
            );
            const issuer = legalEntity;

            // Reserva atômica de número apenas se ainda não reservado (retry reusa o mesmo).
            if (!nfe.number) {
                const { series: reservedSeries, number: newNfeNumber } = await this.storePort.reserveFiscalNumber(
                    store.id,
                    orderData.marketplaceTag,
                    orderData.accountId,
                );
                this.logger.log(`NFe counter reserved: série ${reservedSeries} número ${newNfeNumber} (loja ${store.name})`);
                nfe.number = newNfeNumber;
                nfe.series = reservedSeries;
            } else {
                nfe.series = channel.series;
            }
            nfe.storeId = new Types.ObjectId(store.id);
            nfe.issuer = issuer.toObject();
            await nfe.save();

            // 3. Build XML (Draft) — tpEmis=4 se a LegalEntity já estiver em contingência
            const tpEmis = issuer.contingencyMode ? '4' : '1';
            const xml = await this.xmlBuilderService.buildNFeXml(nfe, orderData, issuer, channel.marketplaceSellerId, tpEmis);

            // 4. Sign XML
            let signedXml = xml;
            if (issuer.certificatePfx) {
                signedXml = await this.signatureService.signXml(xml, issuer.certificatePfx, issuer.certificatePassword);
            } else {
                this.logger.warn('Skipping XML signature: No PFX certificate found.');
            }
            // nfe.accessKey já foi setado dentro de buildNFeXml (passado por referência)

            // 5. Transmit — em contingência já ativa, vai direto pro EPEC; senão tenta
            // authorize() normal e só entra em contingência após falhas de transporte
            // consecutivas (nunca por uma rejeição de negócio, que authorize() não lança).
            let result: any;
            if (issuer.contingencyMode) {
                result = await this.transmitViaEpec(nfe, issuer, signedXml);
            } else {
                try {
                    result = await this.sefazService.authorize(signedXml, nfe.environment, issuer);
                    await this.recordTransportSuccess(issuer);
                } catch (transportErr) {
                    const enteredContingency = await this.recordTransportFailure(issuer);
                    if (enteredContingency) {
                        this.logger.warn(`SEFAZ indisponível — LegalEntity ${issuer._id} entrou em contingência. Transmitindo via EPEC.`);
                        result = await this.transmitViaEpec(nfe, issuer, signedXml);
                    } else {
                        throw transportErr;
                    }
                }
            }

            // Update NFe
            if (result.status === 'authorized_contingency') {
                nfe.status = 'AUTHORIZED_CONTINGENCY';
            } else {
                nfe.status = result.status === 'authorized' ? 'AUTHORIZED' : (result.status === 'processing' ? 'PROCESSING' : (result.status === 'denied' ? 'REJECTED' : 'ERROR'));
            }
            nfe.protocol = result.protocol;

            // When authorized, compose nfeProc (signed NFe + SEFAZ protocol receipt)
            if (result.status === 'authorized' && result.protNFeXml) {
                const cleanSigned = signedXml.replace(/<\?xml[^?]*\?>/g, '').trim();
                nfe.xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${cleanSigned}${result.protNFeXml}</nfeProc>`;
                this.logger.log(`nfeProc composed. Length: ${nfe.xml.length}`);
            } else {
                nfe.xml = result.xml || signedXml;
            }

            if (result.message) {
                nfe.rejectionReason = result.message;
            }

            if (result.responseXml) {
                this.logger.log(`SEFAZ Full Response: ${result.responseXml}`);
            }

            await nfe.save();
            await this.linkNFeToOrder(nfe, orderId);
            this.emitPostEmissionEvent(nfe, orderData);

            return {
                message: nfe.status === 'AUTHORIZED' ? 'NFe autorizada com sucesso' : (nfe.rejectionReason || 'Emissão concluída'),
                nfeId: nfe._id,
                status: nfe.status,
                accessKey: nfe.accessKey,
                rejectionReason: nfe.rejectionReason,
            };

        } catch (error) {
            this.logger.error(`Failed to emit NFe: ${error.message}`);
            nfe.status = 'ERROR';
            nfe.rejectionReason = error.message;
            await nfe.save();
            await this.linkNFeToOrder(nfe, orderId);
            try {
                this.eventEmitter.emit(FISCAL_EVENTS.NFE_ERROR, new FiscalNfeErrorEvent(
                    String(nfe._id),
                    nfe.order ? String(nfe.order) : (nfe.orderId ? String(nfe.orderId) : null),
                    error.message,
                ));
            } catch (emitErr) {
                this.logger.warn(`Falha ao emitir evento de erro para NFe ${nfe._id}: ${emitErr.message}`);
            }
            throw error;
        }
    }

    /** Transmite via EPEC e retorna no mesmo shape de sefazService.authorize
     *  ({status, protocol, message, ...}) para o chamador tratar uniformemente.
     *  Recebe signedXml explicitamente — nfe.xml só é setado em nfe.save() após o
     *  resultado da transmissão (linha ~433), estaria vazio/desatualizado se lido
     *  de nfe.xml aqui (transmitEpec precisa do XML assinado para extrair dest/total). */
    private async transmitViaEpec(nfe: any, issuer: any, signedXml: string): Promise<any> {
        const result = await this.sefazService.transmitEpec(nfe, issuer, signedXml);
        if (result.status !== 'authorized_contingency') {
            throw new Error(`SVC rejeitou o EPEC: ${result.cStat} - ${result.message}`);
        }
        return result;
    }

    /** Incrementa o contador de falhas de transporte consecutivas; ativa
     *  contingencyMode ao ultrapassar o limiar. Retorna true quando a
     *  contingência acabou de ser ativada nesta chamada. */
    private async recordTransportFailure(issuer: any): Promise<boolean> {
        const threshold = Number(process.env.FISCAL_TRANSPORT_FAILURE_THRESHOLD) || 3;
        const failures = (issuer.contingencyConsecutiveFailures || 0) + 1;
        const enteringContingency = failures >= threshold && !issuer.contingencyMode;

        const updated = await this.legalEntityService.updateContingencyState(issuer._id, {
            contingencyConsecutiveFailures: failures,
            contingencySuccessCount: 0,
            ...(enteringContingency ? { contingencyMode: true } : {}),
        });
        issuer.contingencyMode = updated.contingencyMode;
        issuer.contingencyConsecutiveFailures = updated.contingencyConsecutiveFailures;
        return enteringContingency;
    }

    /** Zera o contador de falhas em toda transmissão normal bem-sucedida. */
    private async recordTransportSuccess(issuer: any): Promise<void> {
        if (!issuer.contingencyConsecutiveFailures) return;
        const updated = await this.legalEntityService.updateContingencyState(issuer._id, {
            contingencyConsecutiveFailures: 0,
        });
        issuer.contingencyConsecutiveFailures = updated.contingencyConsecutiveFailures;
    }

    /**
     * Emite uma NFe sem vínculo com Order/marketplace — usado para notas de teste
     * (homologação) e emissões avulsas fora do fluxo normal de pedidos.
     */
    async emitNFeAvulsa(orderData: {
        environment: 'HOMOLOGATION' | 'PRODUCTION';
        buyer: any;
        items: any[];
        totals: any;
        storeId: string;
        marketplaceTag: string;
        accountId: string;
    }) {
        this.logger.log('Iniciando emissão de NFe avulsa (sem Order vinculado)');

        if (!orderData?.buyer || !orderData.buyer.document || !orderData.buyer.address) {
            throw new Error('Dados do destinatário incompletos para emissão.');
        }
        if (!orderData.items || orderData.items.length === 0) {
            throw new Error('A nota não possui itens para emissão.');
        }
        if (!orderData.storeId || !orderData.marketplaceTag || !orderData.accountId) {
            throw new BadRequestException('storeId/marketplaceTag/accountId são obrigatórios para emissão avulsa.');
        }

        const store = await this.storePort.findById(orderData.storeId);
        if (!store) throw new NotFoundException(`Loja ${orderData.storeId} não encontrada.`);
        const issuer = await this.legalEntityService.findById(store.legalEntityId);
        const channel = await this.storePort.resolveFiscalChannel(store.id, orderData.marketplaceTag, orderData.accountId);
        if (!channel) {
            throw new NotFoundException(
                `Loja ${store.name} não tem canal fiscal configurado para ${orderData.marketplaceTag}/${orderData.accountId}.`,
            );
        }

        const { series, number: newNfeNumber } = await this.storePort.reserveFiscalNumber(
            store.id,
            orderData.marketplaceTag,
            orderData.accountId,
        );

        const nfe = new this.fiscalDocumentModel({
            storeId: new Types.ObjectId(store.id),
            issuer: issuer.toObject(),
            status: 'DRAFT',
            environment: orderData.environment === 'HOMOLOGATION' ? 'HOMOLOGATION' : 'PRODUCTION',
            number: newNfeNumber,
            series: series,
            createdAt: new Date(),
        });
        await nfe.save();

        try {
            const xml = await this.xmlBuilderService.buildNFeXml(nfe, orderData, issuer, channel.marketplaceSellerId);

            let signedXml = xml;
            if (issuer.certificatePfx) {
                signedXml = await this.signatureService.signXml(xml, issuer.certificatePfx, issuer.certificatePassword);
            } else {
                this.logger.warn('Skipping XML signature: No PFX certificate found.');
            }

            const result = await this.sefazService.authorize(signedXml, nfe.environment, issuer);

            nfe.status = result.status === 'authorized' ? 'AUTHORIZED' : (result.status === 'processing' ? 'PROCESSING' : (result.status === 'denied' ? 'REJECTED' : 'ERROR'));
            nfe.protocol = result.protocol;

            if (result.status === 'authorized' && result.protNFeXml) {
                const cleanSigned = signedXml.replace(/<\?xml[^?]*\?>/g, '').trim();
                nfe.xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${cleanSigned}${result.protNFeXml}</nfeProc>`;
            } else {
                nfe.xml = result.xml || signedXml;
            }

            if (result.message) {
                nfe.rejectionReason = result.message;
            }

            await nfe.save();
            this.emitPostEmissionEvent(nfe, orderData);

            return {
                nfeId: nfe._id,
                status: nfe.status,
                accessKey: nfe.accessKey,
                protocol: nfe.protocol,
                rejectionReason: nfe.rejectionReason,
            };
        } catch (error) {
            this.logger.error(`Failed to emit NFe avulsa: ${error.message}`);
            nfe.status = 'ERROR';
            nfe.rejectionReason = error.message;
            await nfe.save();
            throw error;
        }
    }

    /** Emite FISCAL_EVENTS.NFE_AUTHORIZED/NFE_REJECTED após persistir o resultado da SEFAZ.
     *  Best-effort: consumidores (DANFE, notificação, e-mail) são independentes — uma
     *  falha aqui nunca deve derrubar a emissão, que já está concluída e persistida. */
    private emitPostEmissionEvent(nfe: any, orderData: any): void {
        try {
            if (nfe.status === 'AUTHORIZED') {
                this.upsertFiscalCustomerFromEmission(orderData);
                this.emitAuthorizedEvent(nfe, orderData?.buyer?.email, orderData?.buyer?.name);
            } else if (nfe.status === 'REJECTED') {
                this.eventEmitter.emit(FISCAL_EVENTS.NFE_REJECTED, new FiscalNfeRejectedEvent(
                    String(nfe._id),
                    nfe.order ? String(nfe.order) : (nfe.orderId ? String(nfe.orderId) : null),
                    nfe.rejectionReason || 'Rejeitada pela SEFAZ',
                ));
            }
        } catch (err) {
            this.logger.warn(`Falha ao emitir evento pós-emissão para NFe ${nfe._id}: ${err.message}`);
        }
    }

    /**
     * Emite FISCAL_EVENTS.NFE_AUTHORIZED — extraído de emitPostEmissionEvent para ser
     * reutilizável pelo EpecSyncWorker, que confirma uma NFe AUTHORIZED_CONTINGENCY para
     * AUTHORIZED (protocolo definitivo) sem ter o orderData completo à mão. Sem isso, o
     * anexo automático ao Mercado Livre (FiscalMlAttachListener), o DANFE
     * (FiscalDanfeService) e a notificação (FiscalNotificationTranslator) nunca disparavam
     * para nenhuma NFe que passou por contingência — gap real, não só na emissão original.
     */
    emitAuthorizedEvent(nfe: any, customerEmail?: string, customerName?: string): void {
        this.eventEmitter.emit(FISCAL_EVENTS.NFE_AUTHORIZED, new FiscalNfeAuthorizedEvent(
            String(nfe._id),
            nfe.order ? String(nfe.order) : (nfe.orderId ? String(nfe.orderId) : null),
            nfe.storeId ? String(nfe.storeId) : null,
            nfe.accessKey,
            nfe.series,
            nfe.number,
            nfe.xml,
            customerEmail,
            customerName,
        ));
    }

    /** Persiste/atualiza o cadastro fiscal reutilizável — só ao emitir com sucesso,
     *  já que aqui os dados foram confirmados por um humano (operador ou o
     *  próprio fluxo automático). Fire-and-forget: não bloqueia nem falha a emissão. */
    private upsertFiscalCustomerFromEmission(orderData: any): void {
        const buyer = orderData?.buyer;
        if (!buyer?.document || !buyer?.name) return;

        const digits = String(buyer.document).replace(/\D/g, '');
        const documentType = digits.length === 14 ? 'CNPJ' : 'CPF';

        this.fiscalCustomerService.upsert({
            document: digits,
            documentType,
            name: buyer.name,
            ie: buyer.ie,
            ieIndicator: buyer.ieIndicator,
            email: buyer.email,
            phone: buyer.phone,
            address: buyer.address ? {
                street: buyer.address.street || '',
                number: buyer.address.number || '',
                complement: buyer.address.complement,
                neighborhood: buyer.address.neighborhood || '',
                city: buyer.address.city || '',
                state: buyer.address.state || '',
                zipCode: buyer.address.zipCode || buyer.address.zip_code || '',
            } : undefined,
        }).catch((err) => {
            this.logger.warn(`Falha ao atualizar FiscalCustomer para documento ${digits}: ${err.message}`);
        });
    }

    private async linkNFeToOrder(nfe: any, orderId: string): Promise<void> {
        try {
            const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
            let dbOrder: any = IS_MONGO_ID.test(orderId)
                ? await this.orderModel.findById(orderId).exec()
                : null;
            if (!dbOrder) {
                dbOrder = await this.orderModel.findOne({ externalId: orderId }).exec();
            }
            if (!dbOrder) return;

            // Link NFe document to order via ObjectId ref
            if (!nfe.order) {
                nfe.order = dbOrder._id;
                await nfe.save();
            }

            // number/série podem não existir ainda (erro de config antes de reservar
            // o número, ex: loja sem canal fiscal) — rótulo genérico nesse caso.
            const nfeLabel = nfe.number ? `NFe ${nfe.number} série ${nfe.series}` : 'NFe';
            const logMsg = nfe.status === 'AUTHORIZED'
                ? `${nfeLabel} autorizada. Chave: ${nfe.accessKey}`
                : nfe.status === 'CANCELLED'
                    ? `${nfeLabel} cancelada. ${nfe.rejectionReason || ''}`
                    : `${nfeLabel} ${nfe.status}. ${nfe.rejectionReason || ''}`;

            // fiscalDocuments é campo virtual (populate por foreignField: 'order' em
            // order.schema.ts) — não existe pra gravar via $addToSet; o vínculo real
            // é nfe.order = dbOrder._id acima, que o virtual já resolve sozinho.
            //
            // $slice mantém só as últimas MAX_LOGS entradas a cada push — mesmo cap já
            // usado em OrderLifecycleService.createLog. Sem isso, retry em loop na
            // emissão (ex.: SEFAZ fora do ar + fila sem dead-letter) acumula um log
            // idêntico por tentativa sem limite, inflando o documento até travar a
            // serialização no app mobile (visto em produção: pedido 2000018139210232,
            // 18.103 entradas, ~5MB, mesmo padrão do incidente documentado em
            // order-lifecycle.service.ts, pedido diferente).
            const MAX_LOGS = 200;
            await this.orderModel.findByIdAndUpdate(dbOrder._id, {
                $push: {
                    logs: {
                        $each: [{
                            logType: 'fiscal',
                            message: logMsg.trim(),
                            details: {
                                nfeId: String(nfe._id),
                                number: nfe.number,
                                series: nfe.series,
                                status: nfe.status,
                                accessKey: nfe.accessKey,
                                protocol: nfe.protocol,
                            },
                            createdAt: new Date(),
                        }],
                        $slice: -MAX_LOGS,
                    },
                },
            }).exec();
        } catch (err) {
            this.logger.warn(`Could not link NFe to order: ${err.message}`);
        }
    }

    async cancelNFe(orderId: string, justification: string): Promise<any> {
        this.logger.log(`Cancelando NFe do pedido ${orderId}...`);

        if (!justification || justification.trim().length < 15) {
            throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres.');
        }

        // Find NFe by order ObjectId or external ID fallback — resolve internal order ObjectId first
        const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
        const cancelOrderId = IS_MONGO_ID.test(orderId) ? new Types.ObjectId(orderId) : null;

        let internalOrderId: Types.ObjectId | null = cancelOrderId;
        if (!internalOrderId) {
            const dbOrder = await this.orderModel.findOne({ externalId: orderId }).lean().exec() as any;
            if (dbOrder) internalOrderId = dbOrder._id;
        }
        if (!internalOrderId) throw new Error(`Pedido ${orderId} não encontrado.`);

        // Atomic lock: only succeed if NFe is currently AUTHORIZED → mark CANCELLING immediately.
        // This prevents concurrent requests from both proceeding to SEFAZ.
        const nfe: any = await this.fiscalDocumentModel.findOneAndUpdate(
            { $or: [{ orderId: internalOrderId }, { order: internalOrderId }], status: 'AUTHORIZED' },
            { $set: { status: 'CANCELLING' } },
            { new: false },  // return pre-update doc so we have accessKey/protocol
        ).exec();

        if (!nfe) {
            // Either NFe doesn't exist or it's not AUTHORIZED (already CANCELLING/CANCELLED/etc.)
            const existing: any = await this.fiscalDocumentModel
                .findOne({ $or: [{ orderId: internalOrderId }, { order: internalOrderId }] })
                .lean().exec();
            if (!existing) throw new Error(`NFe para o pedido ${orderId} não encontrada.`);
            throw new Error(`NFe não pode ser cancelada (status atual: ${existing.status}).`);
        }

        let issuer: any;
        try {
            if (!nfe.storeId) throw new NotFoundException('NFe sem loja emissora vinculada.');
            issuer = await this.legalEntityService.findById(
                (await this.storePort.findById(String(nfe.storeId)))?.legalEntityId,
            );
        } catch (err) {
            // Revert lock if issuer is missing
            await this.fiscalDocumentModel.findByIdAndUpdate(nfe._id, { $set: { status: 'AUTHORIZED' } }).exec();
            throw err;
        }

        let result: any;
        try {
            result = await this.sefazService.cancelNFe(nfe, issuer, justification.trim());
        } catch (err) {
            // Erro de TRANSPORTE (timeout, rede) — não é uma rejeição da SEFAZ. Reverte o
            // lock para que o cancelamento possa ser tentado de novo, em vez de deixar a
            // NFe presa em CANCELLING até intervenção manual no banco.
            await this.fiscalDocumentModel.findByIdAndUpdate(nfe._id, { $set: { status: 'AUTHORIZED' } }).exec();
            this.logger.error(`Falha de transporte ao cancelar NFe ${nfe._id}: ${err.message}`);
            throw err;
        }

        this.logger.log(`Cancelamento SEFAZ retornou: status=${result.status} cStat=${result.cStat} msg=${result.message}`);

        if (result.status === 'cancelled') {
            nfe.status = 'CANCELLED';
            nfe.rejectionReason = justification.trim();
            nfe.protocol = result.protocol || nfe.protocol;
            await nfe.save();
            await this.linkNFeToOrder(nfe, orderId);
            try {
                this.eventEmitter.emit(FISCAL_EVENTS.NFE_CANCELLED, new FiscalNfeCancelledEvent(
                    String(nfe._id),
                    nfe.order ? String(nfe.order) : (nfe.orderId ? String(nfe.orderId) : null),
                    nfe.accessKey,
                    justification.trim(),
                ));
            } catch (err) {
                this.logger.warn(`Falha ao emitir evento de cancelamento para NFe ${nfe._id}: ${err.message}`);
            }
        } else {
            // SEFAZ rejected — revert lock so the NFe can be retried or inspected
            await this.fiscalDocumentModel.findByIdAndUpdate(nfe._id, { $set: { status: 'AUTHORIZED' } }).exec();
            throw new Error(`SEFAZ rejeitou o cancelamento: ${result.cStat} - ${result.message}`);
        }

        return {
            status: nfe.status,
            message: result.message,
            accessKey: nfe.accessKey,
            protocol: result.protocol,
        };
    }

    /**
     * Carta de Correção Eletrônica — corrige campos descritivos de uma NFe já
     * autorizada (nunca valores, quantidade, data ou dados cadastrais de
     * emitente/destinatário — restrição legal, não há campo estruturado que
     * permita alterar dado protegido, só texto livre). Síncrona no request
     * (mesma decisão do cancelamento: ação explícita, baixo volume).
     */
    async correctNFe(orderId: string, correctionText: string): Promise<any> {
        this.logger.log(`Emitindo CC-e para pedido ${orderId}...`);

        if (!correctionText || correctionText.trim().length < 15) {
            throw new BadRequestException('Texto de correção deve ter no mínimo 15 caracteres.');
        }

        const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
        const internalOrderId = IS_MONGO_ID.test(orderId) ? new Types.ObjectId(orderId) : await this.resolveInternalOrderId(orderId);
        if (!internalOrderId) throw new NotFoundException(`Pedido ${orderId} não encontrado.`);

        const nfe: any = await this.fiscalDocumentModel
            .findOne({ $or: [{ orderId: internalOrderId }, { order: internalOrderId }], status: 'AUTHORIZED' })
            .sort({ createdAt: -1 })
            .exec();
        if (!nfe) throw new NotFoundException(`NFe autorizada para o pedido ${orderId} não encontrada.`);
        if (!nfe.storeId) throw new NotFoundException('NFe sem loja emissora vinculada.');

        const store = await this.storePort.findById(String(nfe.storeId));
        const issuer = await this.legalEntityService.findById(store?.legalEntityId);

        const sequence = (nfe.cceEvents?.length || 0) + 1;
        const result = await this.sefazService.correctNFe(nfe, issuer, correctionText.trim(), sequence);

        if (result.status !== 'registered') {
            throw new Error(`SEFAZ rejeitou a CC-e: ${result.cStat} - ${result.message}`);
        }

        nfe.cceEvents = [
            ...(nfe.cceEvents || []),
            { sequence, text: correctionText.trim(), protocol: result.protocol, createdAt: new Date() },
        ];
        await nfe.save();

        return {
            sequence,
            protocol: result.protocol,
            message: result.message,
        };
    }

    /**
     * Inutiliza uma faixa de numeração NUNCA emitida (distinto de cancelar uma
     * nota já autorizada). Ação administrativa rara e deliberada.
     */
    async inutilizeRange(params: {
        storeId: string;
        series: number;
        from: number;
        to: number;
        justification: string;
        environment?: string;
    }): Promise<any> {
        const { storeId, series, from, to, justification, environment } = params;
        if (!justification || justification.trim().length < 15) {
            throw new BadRequestException('Justificativa deve ter no mínimo 15 caracteres.');
        }
        if (from > to) {
            throw new BadRequestException('Número inicial não pode ser maior que o número final.');
        }

        const store = await this.storePort.findById(storeId);
        if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
        const issuer = await this.legalEntityService.findById(store.legalEntityId);

        const uf = issuer.address?.state || 'PE';
        const result = await this.sefazService.inutilizeRange({
            issuer,
            uf,
            series,
            from,
            to,
            justification: justification.trim(),
            environment: environment || 'PRODUCTION',
        });

        await this.fiscalInutilizationModel.create({
            legalEntityId: issuer._id,
            storeId: store.id,
            series,
            from,
            to,
            justification: justification.trim(),
            protocol: result.protocol,
            status: result.status === 'authorized' ? 'AUTHORIZED' : 'REJECTED',
            rejectionReason: result.status === 'authorized' ? undefined : result.message,
        });

        if (result.status !== 'authorized') {
            throw new Error(`SEFAZ rejeitou a inutilização: ${result.cStat} - ${result.message}`);
        }

        return { status: result.status, protocol: result.protocol, message: result.message };
    }

    /** Returns the single most-relevant NFe for an order:
     *  prefers AUTHORIZED → PROCESSING → ERROR/DRAFT/REJECTED → CANCELLED (last resort).
     */
    async getNFeByOrderId(orderId: string) {
        const docs = await this.listNFesByOrderId(orderId);
        if (!docs.length) return null;
        const priority = ['AUTHORIZED', 'PROCESSING', 'CANCELLING', 'ERROR', 'REJECTED', 'DRAFT', 'CANCELLED', 'CANCELED'];
        return docs.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];
    }

    /** XML oficial (assinado, ou o de trabalho se a assinatura ainda não rodou) da NFe mais
     *  relevante do pedido, para download — mesma prioridade de getNFeByOrderId. */
    async getNFeXml(orderId: string): Promise<{ xml: string; accessKey: string } | null> {
        const oid = await this.resolveInternalOrderId(orderId);
        if (!oid) return null;
        const docs = await this.fiscalDocumentModel
            .find({ $or: [{ orderId: oid }, { order: oid }] })
            .select('xml xmlSigned accessKey status')
            .lean()
            .exec();
        if (!docs.length) return null;
        const priority = ['AUTHORIZED', 'PROCESSING', 'CANCELLING', 'ERROR', 'REJECTED', 'DRAFT', 'CANCELLED', 'CANCELED'];
        const nfe: any = docs.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];
        const xml = nfe.xmlSigned || nfe.xml;
        if (!xml) return null;
        return { xml, accessKey: nfe.accessKey };
    }

    /** Returns all NFe documents for an order, newest first. */
    async listNFesByOrderId(orderId: string) {
        const oid = await this.resolveInternalOrderId(orderId);
        if (!oid) return [];
        return this.fiscalDocumentModel
            .find({ $or: [{ orderId: oid }, { order: oid }] })
            .sort({ createdAt: -1 })
            .select('-xml -xmlSigned')   // omit large XML fields from list queries
            .exec();
    }

    /** Resolves an orderId (MongoDB ObjectId string or marketplace externalId) to the internal _id. */
    private async resolveInternalOrderId(orderId: string): Promise<Types.ObjectId | null> {
        const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
        if (IS_MONGO_ID.test(orderId)) {
            return new Types.ObjectId(orderId);
        }
        const order = await this.orderModel
            .findOne({ externalId: orderId })
            .select('_id')
            .lean()
            .exec() as any;
        return order ? (order._id as Types.ObjectId) : null;
    }
}
