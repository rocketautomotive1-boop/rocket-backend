import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { OrderDocument, OrderModel } from '../schemas/order.schema';
import { MarketplaceModel, MarketplaceDocument } from '../../marketplace/schemas/marketplace.schema';
import { buildSignedParams, buildHeaders, getShopeeBaseUrl } from '../../marketplace/adapters/shopee/shopee-utils';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';

// ── Shared types ────────────────────────────────────────────────────────────────

export interface MarketplaceOrderDetails {
    marketplace: string;
    supported: boolean;
    status?: string;
    /** ML pack_id for multi-order packs */
    packId?: string;
    /** e.g. "buy_equals_pay" */
    buyingMode?: string;
    /** e.g. "marketplace" */
    channel?: string;
    /** Per-item detail from the marketplace */
    itemsDetail?: {
        id: string;
        title: string;
        listingTypeId?: string;
        categoryId?: string;
        condition?: string;
        saleFee?: number;
        grossPrice?: number;
    }[];
    shipping?: {
        id?: string;
        status?: string;
        substatus?: string;
        trackingCode?: string;
        trackingMethod?: string;
        carrier?: string;
        estimatedDelivery?: string;
        /** Date seller must post by */
        bufferingDate?: string;
        serviceType?: string;
        logisticType?: string;
        /** Freight cost billed to the seller (e.g. ML list_cost) */
        listCost?: number;
        /** Freight cost charged to the buyer (0 = free shipping for buyer) */
        receiverShippingCost?: number;
        /** Base cost before discounts/components */
        baseCost?: number;
        /** ML cost_components breakdown */
        costComponents?: {
            ratio?: number;
            loyalDiscount?: number;
            specialDiscount?: number;
            compensation?: number;
        };
        /** Substatus timeline */
        substatusHistory?: { date: string; substatus: string; status: string }[];
        dimensions?: { height?: number; width?: number; length?: number; weight?: number };
    };
    payment?: {
        method?: string;
        type?: string;
        installments?: number;
        /** Total paid by buyer */
        totalPaidAmount?: number;
        /** Marketplace commission fee */
        fee?: number;
        /** Taxes retained */
        taxesAmount?: number;
        /** Coupon discount */
        couponAmount?: number;
        /** Net received by seller (from ML payment object) */
        netAmount?: number;
        currencyId?: string;
        paidAt?: string;
        /** When seller can withdraw the funds */
        moneyReleaseDate?: string;
        moneyReleaseDays?: number;
        moneyReleaseStatus?: string;
        authorizationCode?: string;
    };
    buyer?: {
        id?: string;
        nickname?: string;
        name?: string;
        email?: string;
        document?: string;
        documentType?: string;
        address?: {
            street?: string;
            number?: string;
            complement?: string;
            neighborhood?: string;
            city?: string;
            state?: string;
            zipCode?: string;
        };
        reputation?: { positive?: number; negative?: number; neutral?: number };
    };
    /** Normalized financial summary usable across marketplaces */
    financial?: MarketplaceFinancialSummary;
    statusHistory?: { status: string; date: string }[];
    /** ML NFe invoice already issued via ML fiscal flow */
    mlInvoice?: {
        id: string;
        status: string;
        number: number;
        series: string;
        issuedDate: string;
        invoiceKey: string;
        danfePath: string;
        xmlPath: string;
        protocol: string;
        statusDescription: string;
    } | null;
    /** Date seller must wait before shipping (programmed delivery / Envio Programado) */
    shippingHoldDate?: string | null;
    raw?: any;
}

export interface MarketplaceFinancialCharge {
    amount: number;
    description: string;
    subType?: string;
    debitedFromOperation: boolean;
    legalDocumentNumber?: string | null;
    legalDocumentStatus?: string | null;
    legalDocumentStatusDescription?: string | null;
    documentId?: number | null;
    shippingId?: string | null;
    packId?: string | null;
    createdAt?: string | null;
}

export interface MarketplaceFinancialSummary {
    /** Total amount paid by buyer */
    grossAmount: number;
    /** Sum of all marketplace charges (sale fee) */
    saleFee: number;
    /** Detailed breakdown of sale fee charges */
    charges: MarketplaceFinancialCharge[];
    /** Freight cost billed to seller */
    freightCost: number;
    /** Coupon amount */
    couponAmount: number;
    /** Taxes retained */
    taxesAmount: number;
    /** Net amount seller receives after all deductions */
    netAmount: number;
    /** If money release date is known */
    moneyReleaseDate?: string;
    moneyReleaseDays?: number;
    moneyReleaseStatus?: string;
}

// ── Service ─────────────────────────────────────────────────────────────────────

@Injectable()
export class OrderMarketplaceDetailsService {
    private readonly logger = new Logger(OrderMarketplaceDetailsService.name);

    constructor(
        @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
        @InjectModel(MarketplaceModel.name) private readonly marketplaceModel: Model<MarketplaceDocument>,
        @Inject(forwardRef(() => MarketplaceOrderService))
        private readonly marketplaceOrderService: MarketplaceOrderService,
    ) {}

    async getDetails(orderId: string): Promise<MarketplaceOrderDetails> {
        const { order, marketplace, token } = await this.resolveContext(orderId);
        const tag = (marketplace.tag || '').toLowerCase();

        let result: MarketplaceOrderDetails;
        switch (tag) {
            case 'mercadolivre':
                result = await this.getMercadoLivreDetails(order, marketplace, token);
                break;
            case 'shopee':
                result = await this.getShopeeDetails(order, marketplace, token);
                break;
            default:
                result = await this.getGenericDetails(order, marketplace);
        }

        // Persist buyer data (especially CPF/CNPJ) back to MongoDB so NFe emission
        // can use it without re-fetching from the marketplace.
        await this.persistBuyerToOrder(order, result.buyer);

        return result;
    }

    /**
     * Generic handler for marketplaces without a dedicated implementation (e.g. Amazon).
     * Delegates to MarketplaceOrderService which uses the registered adapter — for Amazon
     * this triggers the full RDT cascade to fetch CPF/CNPJ.
     */
    private async getGenericDetails(order: any, marketplace: any): Promise<MarketplaceOrderDetails> {
        const externalId = String(order.externalId || '');
        const marketplaceId = String(order.marketplaceId || '');

        try {
            const fullOrder = await this.marketplaceOrderService.getOrderDetails(externalId, marketplaceId);

            const payment = fullOrder.payments?.length
                ? fullOrder.payments.find((p: any) => p.status === 'approved') ?? fullOrder.payments[0]
                : null;

            return {
                marketplace: marketplace.name,
                supported: true,
                buyer: fullOrder.buyer ? {
                    name:     fullOrder.buyer.name              || '',
                    email:    String(fullOrder.buyer.id  || ''),
                    document: fullOrder.buyer.document          || '',
                    address:  fullOrder.buyer.address ? {
                        street:       fullOrder.buyer.address.street       || '',
                        number:       fullOrder.buyer.address.number       || '',
                        complement:   fullOrder.buyer.address.complement   || '',
                        neighborhood: fullOrder.buyer.address.neighborhood || '',
                        city:         fullOrder.buyer.address.city         || '',
                        state:        fullOrder.buyer.address.state        || '',
                        zipCode:      fullOrder.buyer.address.zip_code || '',
                    } : undefined,
                } : undefined,
                shipping: fullOrder.shipping ? {
                    id:     fullOrder.shipping.id,
                    status: fullOrder.shipping.status,
                    trackingCode: (fullOrder as any).trackingCode,
                } : undefined,
                payment: payment ? {
                    method:             payment.payment_method_id,
                    type:               payment.payment_type,
                    totalPaidAmount:    payment.total_paid_amount,
                    authorizationCode:  payment.authorization_code,
                    installments:       payment.installments,
                    paidAt:             payment.date_approved,
                } : undefined,
                raw: fullOrder.original_data,
            };
        } catch (err: any) {
            this.logger.warn(`[GenericDetails] ${marketplace.name}: ${err.message}`);
            return { marketplace: marketplace.name, supported: true };
        }
    }

    /**
     * Persist buyer CPF/CNPJ (and address if missing) to the order in MongoDB.
     * Called after every getDetails() so the data is available for NFe emission
     * without a second round-trip to the marketplace API.
     */
    private async persistBuyerToOrder(order: any, buyer: MarketplaceOrderDetails['buyer']): Promise<void> {
        if (!buyer) return;
        try {
            const set: Record<string, any> = {};
            if (buyer.document && !order.customer?.document) set['customer.document'] = buyer.document;
            if (buyer.name    && !order.customer?.name)     set['customer.name']     = buyer.name;
            if (buyer.email   && !order.customer?.email)    set['customer.email']    = buyer.email;
            if (buyer.address?.zipCode && !order.customer?.address?.zipCode) {
                set['customer.address'] = {
                    zipCode:      buyer.address.zipCode      || '',
                    street:       buyer.address.street       || '',
                    number:       buyer.address.number       || '',
                    neighborhood: buyer.address.neighborhood || '',
                    city:         buyer.address.city         || '',
                    state:        buyer.address.state        || '',
                };
            }
            if (Object.keys(set).length > 0) {
                await this.orderModel.findByIdAndUpdate(order._id, { $set: set }).exec();
                this.logger.log(`[persistBuyer] Dados do comprador salvos para pedido ${order._id}`);
            }
        } catch (err: any) {
            this.logger.warn(`[persistBuyer] Falha ao salvar dados do comprador: ${err.message}`);
        }
    }

    /**
     * Fetch and normalize the ML billing integration details for a given order.
     *
     * Source: GET /billing/integration/group/ML/order/details?order_ids={externalId}
     *
     * Returns a normalized MarketplaceFinancialSummary plus raw data.
     */
    async getMlBillingDetails(orderId: string): Promise<any> {
        const { order, marketplace, token } = await this.resolveContext(orderId);
        const tag = (marketplace.tag || '').toLowerCase();

        if (!tag.includes('mercado')) {
            return { supported: false, marketplace: marketplace.name };
        }

        const externalId = (order as any).externalId;
        if (!externalId) throw new Error('External order ID not found');

        this.logger.log(`[ML Billing] Fetching billing details for order ${externalId}`);

        try {
            const response = await axios.get(
                `https://api.mercadolibre.com/billing/integration/group/ML/order/details`,
                {
                    headers: { Authorization: `Bearer ${token.accessToken}` },
                    params: { order_ids: externalId },
                }
            );

            const rawResult = response.data?.results?.[0] ?? null;
            if (!rawResult) {
                return { supported: true, data: null };
            }

            const paymentInfo = rawResult.payment_info?.[0] ?? {};
            const saleFeeRaw = rawResult.sale_fee ?? {};
            const detailsRaw: any[] = rawResult.details ?? [];

            // Normalize charges from details[] — include NFe document status per charge
            const charges: MarketplaceFinancialCharge[] = detailsRaw.map((d: any) => ({
                amount: Number(d.charge_info?.detail_amount ?? 0),
                description: d.charge_info?.transaction_detail ?? '',
                subType: d.charge_info?.detail_sub_type ?? '',
                debitedFromOperation: d.charge_info?.debited_from_operation === 'YES',
                // NFe / fiscal document status for this charge
                legalDocumentNumber: d.charge_info?.legal_document_number ?? null,
                legalDocumentStatus: d.charge_info?.legal_document_status ?? null,
                legalDocumentStatusDescription: d.charge_info?.legal_document_status_description ?? null,
                documentId: d.document_info?.document_id ?? null,
                shippingId: d.shipping_info?.shipping_id ?? null,
                packId: d.shipping_info?.pack_id ?? null,
                createdAt: d.charge_info?.creation_date_time ?? null,
            }));

            // Tax details from payment_info
            const taxDetails: { name: string; amount: number }[] =
                (paymentInfo.tax_details ?? []).map((t: any) => ({
                    name: t.name || t.description || 'Imposto',
                    amount: Number(t.amount ?? 0),
                }));

            const saleFee = Number(saleFeeRaw.gross ?? 0);
            const taxesAmount = taxDetails.reduce((s, t) => s + Math.abs(t.amount), 0);

            const data = {
                orderId: rawResult.order_id,
                saleFee: {
                    gross: saleFee,
                    net: Number(saleFeeRaw.net ?? saleFee),
                    rebate: Number(saleFeeRaw.rebate ?? 0),
                    discount: Number(saleFeeRaw.discount ?? 0),
                },
                charges,
                taxDetails,
                paymentInfo: {
                    paymentId: paymentInfo.payment_id,
                    dateApproved: paymentInfo.date_approved,
                    moneyReleaseDate: paymentInfo.money_release_date,
                    moneyReleaseDays: paymentInfo.money_release_days,
                    moneyReleaseStatus: paymentInfo.money_release_status,
                    paymentMethodId: paymentInfo.payment_method_id,
                    status: paymentInfo.status,
                },
            };

            return { supported: true, data };
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.warn(`[ML Billing] Failed for order ${externalId}: ${detail}`);
            return { supported: true, error: detail };
        }
    }

    // ── ML ───────────────────────────────────────────────────────────────────────

    private async getMercadoLivreDetails(order: any, marketplace: any, token: any): Promise<MarketplaceOrderDetails> {
        const externalId = order.externalId;
        if (!externalId) throw new NotFoundException('External order ID not found');

        this.logger.log(`[ML Details] Fetching order ${externalId}`);

        try {
            const response = await axios.get(
                `https://api.mercadolibre.com/orders/${externalId}`,
                { headers: { Authorization: `Bearer ${token.accessToken}` } }
            );
            const raw = response.data;

            const shipment = raw.shipping || {};
            const payment = raw.payments?.[0] || {};
            const buyer = raw.buyer || {};

            // sale_fee from order_items (sum all items)
            const itemSaleFee: number = (raw.order_items || []).reduce(
                (acc: number, i: any) => acc + (Number(i.sale_fee ?? 0) * Number(i.quantity ?? 1)),
                0,
            );

            // Buyer reputation (best-effort)
            let reputation: any = {};
            if (buyer.id) {
                try {
                    const repRes = await axios.get(
                        `https://api.mercadolibre.com/users/${buyer.id}`,
                        { headers: { Authorization: `Bearer ${token.accessToken}` } }
                    );
                    reputation = repRes.data?.seller_reputation?.transactions || {};
                } catch { /* ignore */ }
            }

            // Shipment details (for listCost, tracking, dimensions)
            let shipmentDetails: any = {};
            if (shipment.id) {
                try {
                    const shipRes = await axios.get(
                        `https://api.mercadolibre.com/shipments/${shipment.id}`,
                        { headers: { Authorization: `Bearer ${token.accessToken}` } }
                    );
                    shipmentDetails = shipRes.data || {};
                } catch { /* ignore */ }
            }

            // ML Invoice by shipment — detect if NFe already issued through ML fiscal flow
            let mlInvoice: MarketplaceOrderDetails['mlInvoice'] = null;
            const shipmentId = shipment.id || shipmentDetails.id;
            if (shipmentId) {
                try {
                    const sellerId =
                        token.additionalData?.sellerId ||
                        token.additionalData?.user_id  ||
                        (marketplace as any).config?.sellerId ||
                        (marketplace as any).sellerId;
                    if (sellerId) {
                        const invoiceRes = await axios.get(
                            `https://api.mercadolibre.com/users/${sellerId}/invoices/shipments/${shipmentId}`,
                            { headers: { Authorization: `Bearer ${token.accessToken}` } }
                        );
                        const inv = invoiceRes.data;
                        if (inv?.id) {
                            mlInvoice = {
                                id:                String(inv.id),
                                status:            inv.status || '',
                                number:            inv.invoice_number,
                                series:            String(inv.invoice_series),
                                issuedDate:        inv.issued_date || '',
                                invoiceKey:        inv.attributes?.invoice_key || '',
                                danfePath:         inv.attributes?.danfe_location || '',
                                xmlPath:           inv.attributes?.xml_location   || '',
                                protocol:          inv.attributes?.protocol || '',
                                statusDescription: inv.attributes?.status_description || '',
                            };
                        }
                    }
                } catch { /* no invoice yet — 404 or not supported */ }
            }

            // Shipping hold date — programmed delivery (Envio Programado)
            // ML sets estimated_schedule_delivery_date when buyer schedules a date
            const scheduleDate = shipmentDetails.shipping_option?.estimated_schedule_delivery_date?.date;
            const shippingHoldDate = scheduleDate && new Date(scheduleDate) > new Date()
                ? scheduleDate as string
                : null;

            // Billing info (CPF/CNPJ) for NFe pre-fill
            let billingData: any = null;
            const billingInfoId = buyer.billing_info?.id;
            if (billingInfoId) {
                try {
                    const billRes = await axios.get(
                        `https://api.mercadolibre.com/orders/billing-info/MLB/${billingInfoId}`,
                        { headers: { Authorization: `Bearer ${token.accessToken}` } }
                    );
                    billingData = billRes.data?.buyer?.billing_info || null;
                } catch { /* ignore */ }
            }

            // Buyer data
            const buyerDocument = billingData?.identification?.number || '';
            const buyerDocumentType = billingData?.identification?.type || '';
            const buyerFullName = billingData
                ? [billingData.name, billingData.last_name].filter(Boolean).join(' ')
                : `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim();

            // Prefer receiver_address from shipment for delivery address, billing address as fallback
            const ra = shipmentDetails.receiver_address || {};
            const ba = billingData?.address;
            const buyerAddress = (ra.zip_code || ba?.zip_code) ? {
                street:       ra.street_name    || ba?.street_name    || '',
                number:       ra.street_number  || ba?.street_number  || '',
                complement:   ra.comment        || ba?.comment        || '',
                neighborhood: ra.neighborhood?.name || ba?.neighborhood || '',
                city:         ra.city?.name     || ba?.city_name      || '',
                state:        ra.state?.id?.replace('BR-', '') || ba?.state?.code?.replace('BR-', '') || ba?.state?.name || '',
                zipCode:      ra.zip_code       || ba?.zip_code       || '',
            } : undefined;

            // Freight costs
            const listCost = Number(shipmentDetails.shipping_option?.list_cost ?? 0);
            const receiverShippingCost = Number(shipmentDetails.shipping_option?.cost ?? 0);
            const baseCost = Number(shipmentDetails.base_cost ?? 0);

            // Financial summary
            // For ML, raw.total_amount is the product total and should be used as gross revenue.
            // payment.total_paid_amount may come discounted by marketplace-funded coupons.
            const grossAmount = Number(raw.total_amount || payment.total_paid_amount || 0);
            const saleFee = itemSaleFee || Number(payment.marketplace_fee || 0);
            const couponAmount = Number(payment.coupon_amount || 0);
            const taxesAmount = Number(payment.taxes_amount || 0);
            const netAmount = Math.max(0, grossAmount - saleFee - listCost - taxesAmount);

            const financial: MarketplaceFinancialSummary = {
                grossAmount,
                saleFee,
                charges: [],   // populated later by billing API if needed
                freightCost: listCost,
                couponAmount,
                taxesAmount,
                netAmount,
                moneyReleaseDate:   payment.money_release_date   || undefined,
                moneyReleaseDays:   payment.money_release_days   || undefined,
                moneyReleaseStatus: payment.money_release_status || undefined,
            };

            return {
                marketplace: 'Mercado Livre',
                supported: true,
                status: raw.status,
                packId: raw.pack_id ? String(raw.pack_id) : undefined,
                buyingMode: raw.buying_mode || undefined,
                channel: raw.context?.channel || undefined,
                itemsDetail: (raw.order_items || []).map((i: any) => ({
                    id: i.item?.id || '',
                    title: i.item?.title || '',
                    listingTypeId: i.listing_type_id || i.item?.listing_type_id || undefined,
                    categoryId: i.item?.category_id || undefined,
                    condition: i.item?.condition || undefined,
                    saleFee: Number(i.sale_fee ?? 0) || undefined,
                    grossPrice: Number(i.gross_price ?? i.unit_price ?? 0) || undefined,
                })),
                shipping: {
                    id: String(shipment.id || shipmentDetails.id || ''),
                    status: shipmentDetails.status || shipment.status || '',
                    substatus: shipmentDetails.substatus || '',
                    trackingCode: shipmentDetails.tracking_number || shipment.tracking_number || order.trackingCode || '',
                    trackingMethod: shipmentDetails.tracking_method || '',
                    carrier: shipmentDetails.shipping_option?.name || String(shipmentDetails.service_id || ''),
                    estimatedDelivery: shipmentDetails.shipping_option?.estimated_delivery_final?.date
                        || shipmentDetails.shipping_option?.estimated_delivery_limit?.date
                        || shipmentDetails.estimated_delivery_final?.date
                        || '',
                    bufferingDate: shipmentDetails.shipping_option?.buffering?.date || '',
                    serviceType: shipmentDetails.shipping_mode || '',
                    logisticType: shipmentDetails.logistic_type || '',
                    listCost,
                    receiverShippingCost,
                    baseCost,
                    costComponents: shipmentDetails.cost_components ? {
                        ratio:           shipmentDetails.cost_components.ratio ?? 0,
                        loyalDiscount:   shipmentDetails.cost_components.loyal_discount ?? 0,
                        specialDiscount: shipmentDetails.cost_components.special_discount ?? 0,
                        compensation:    shipmentDetails.cost_components.compensation ?? 0,
                    } : undefined,
                    substatusHistory: (shipmentDetails.substatus_history || []).map((h: any) => ({
                        date:      h.date      || '',
                        substatus: h.substatus || '',
                        status:    h.status    || '',
                    })),
                    dimensions: shipmentDetails.dimensions ? {
                        height: shipmentDetails.dimensions.height,
                        width:  shipmentDetails.dimensions.width,
                        length: shipmentDetails.dimensions.length,
                        weight: shipmentDetails.dimensions.weight,
                    } : undefined,
                },
                payment: {
                    method: payment.payment_method_id || payment.payment_type || '',
                    type: payment.operation_type || '',
                    installments: payment.installments || 1,
                    totalPaidAmount: grossAmount,
                    fee: saleFee,
                    taxesAmount,
                    couponAmount,
                    netAmount: Number(payment.net_received_amount || 0) || netAmount,
                    currencyId: raw.currency_id || 'BRL',
                    paidAt: payment.date_approved || payment.date_created || '',
                    authorizationCode: payment.authorization_code || '',
                },
                buyer: {
                    id: String(buyer.id || ''),
                    nickname: buyer.nickname || '',
                    name: buyerFullName,
                    email: buyer.email || '',
                    document: buyerDocument,
                    documentType: buyerDocumentType,
                    address: buyerAddress,
                    reputation: {
                        positive: reputation.ratings?.positive || 0,
                        negative: reputation.ratings?.negative || 0,
                        neutral:  reputation.ratings?.neutral  || 0,
                    },
                },
                financial,
                statusHistory: (raw.status_history?.date || []).map((h: any) => ({
                    status: h.status || '',
                    date:   h.date   || '',
                })),
                mlInvoice,
                shippingHoldDate,
                raw,
            };
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`[ML Details] Failed for order ${externalId}: ${detail}`);
            throw new Error(`Failed to load marketplace details: ${detail}`);
        }
    }

    // ── Shopee ───────────────────────────────────────────────────────────────────

    private async getShopeeDetails(order: any, marketplace: any, token: any): Promise<MarketplaceOrderDetails> {
        const shopId = token.additionalData?.shopId || token.shopId;
        const orderSn = order.externalId;
        if (!shopId || !orderSn) throw new NotFoundException('ShopId or order SN not found');

        const baseUrl = getShopeeBaseUrl();
        const path = '/order/get_order_detail';
        const timestamp = Math.floor(Date.now() / 1000);

        const extraFields = [
            'buyer_info', 'pay_time', 'recipient_address', 'total_amount',
            'package_list', 'shipping_carrier', 'estimated_shipping_fee',
            'pay_order_sn', 'invoice_data',
        ].join(',');

        const queryParams = {
            order_sn_list: orderSn,
            response_optional_fields: extraFields,
        };

        const signedParams = buildSignedParams(path, timestamp, token.accessToken, Number(shopId), queryParams);

        this.logger.log(`[Shopee Details] Fetching order ${orderSn}`);

        try {
            const response = await axios.get(`${baseUrl}${path}`, {
                headers: buildHeaders(),
                params: { ...signedParams, access_token: token.accessToken, shop_id: Number(shopId), ...queryParams },
            });

            const raw = response.data?.response?.order_list?.[0] || {};

            const pkg = raw.package_list?.[0] || {};
            const buyer = raw.buyer_info || {};
            const grossAmount = Number(raw.total_amount || 0);
            const freightCost = Number(raw.estimated_shipping_fee || 0);

            return {
                marketplace: 'Shopee',
                supported: true,
                status: raw.order_status || '',
                shipping: {
                    status: raw.order_status || '',
                    trackingCode: pkg.tracking_no || order.trackingCode || '',
                    carrier: raw.shipping_carrier || pkg.shipping_carrier || '',
                    serviceType: raw.shipping_carrier || '',
                    listCost: freightCost,
                    receiverShippingCost: 0,
                },
                payment: {
                    method: raw.payment_method || '',
                    totalPaidAmount: grossAmount,
                    currencyId: 'BRL',
                    paidAt: raw.pay_time ? new Date(raw.pay_time * 1000).toISOString() : '',
                },
                buyer: {
                    id: String(buyer.user_id || ''),
                    nickname: buyer.buyer_username || '',
                    name: raw.recipient_address?.name || '',
                    email: '',
                },
                financial: {
                    grossAmount,
                    saleFee: 0,
                    charges: [],
                    freightCost,
                    couponAmount: 0,
                    taxesAmount: 0,
                    netAmount: grossAmount - freightCost,
                },
                raw,
            };
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`[Shopee Details] Failed for order ${orderSn}: ${detail}`);
            throw new Error(`Failed to load Shopee details: ${detail}`);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private async resolveContext(orderId: string) {
        const order = await this.orderModel.findById(orderId).lean().exec();
        if (!order) throw new NotFoundException(`Order ${orderId} not found`);

        const marketplace = await this.marketplaceModel
            .findById((order as any).marketplaceId)
            .lean()
            .exec();
        if (!marketplace) throw new NotFoundException(`Marketplace not found for order ${orderId}`);

        const token = (marketplace as any).tokens?.find((t: any) => t.isActive);
        if (!token) throw new NotFoundException(`No active token for marketplace ${marketplace.name}`);

        return { order, marketplace, token };
    }
}
