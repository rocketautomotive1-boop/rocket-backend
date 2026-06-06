import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import * as FormData from 'form-data';
import { OrderDocument, OrderModel } from '../schemas/order.schema';
import { MarketplaceModel, MarketplaceDocument } from '../../marketplace/schemas/marketplace.schema';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { buildSignedParams, buildHeaders, getShopeeBaseUrl } from '../../marketplace/adapters/shopee/shopee-utils';

export interface ChatMessage {
    id: string;
    from: 'seller' | 'buyer';
    text: string;
    attachments?: { url: string; type: string }[];
    createdAt: string;
}

export interface MessageThread {
    messages: ChatMessage[];
    buyerName?: string;
    buyerNickname?: string;
    supported: boolean;
    marketplaceName: string;
    packId?: string;
    conversationId?: string;
}

@Injectable()
export class OrderMessagingService {
    private readonly logger = new Logger(OrderMessagingService.name);

    constructor(
        @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
        @InjectModel(MarketplaceModel.name) private readonly marketplaceModel: Model<MarketplaceDocument>,
        private readonly auth: MarketplaceAuthService,
    ) {}

    async getMessages(orderId: string): Promise<MessageThread> {
        const { order, marketplace, token } = await this.resolveContext(orderId);
        const tag = (marketplace.tag || '').toLowerCase();

        switch (tag) {
            case 'mercadolivre':
                return this.getMercadoLivreMessages(order, marketplace, token);
            case 'shopee':
                return this.getShopeeMessages(order, marketplace, token);
            default:
                return {
                    messages: [],
                    supported: false,
                    marketplaceName: marketplace.name,
                };
        }
    }

    async sendMessage(orderId: string, text: string): Promise<{ success: boolean }> {
        if (!text?.trim()) throw new BadRequestException('Message text is required');

        const { order, marketplace, token } = await this.resolveContext(orderId);
        const tag = (marketplace.tag || '').toLowerCase();

        switch (tag) {
            case 'mercadolivre':
                await this.sendMercadoLivreMessage(order, marketplace, token, text.trim());
                return { success: true };
            case 'shopee':
                await this.sendShopeeMessage(order, marketplace, token, text.trim());
                return { success: true };
            default:
                throw new BadRequestException(
                    `Messaging not supported for marketplace "${marketplace.name}". ` +
                    `Supported: Mercado Livre, Shopee.`
                );
        }
    }

    // ── Mercado Livre ──────────────────────────────────────────────────────────

    private async getMercadoLivreMessages(order: any, marketplace: any, token: any): Promise<MessageThread> {
        const packId = order.marketplaceData?.pack_id
            || order.marketplaceData?.shipping?.id
            || order.externalId;
        const sellerId = token.additionalData?.seller_id || token.additionalData?.user_id;

        if (!packId) throw new NotFoundException('Pack ID not found for this order');
        if (!sellerId) throw new NotFoundException('Seller ID not found in ML token');

        this.logger.log(`[ML Messages] Fetching messages for pack ${packId}`);

        try {
            const response = await axios.get(
                `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}`,
                {
                    headers: { Authorization: `Bearer ${token.accessToken}` },
                    params: { tag: 'post_sale', limit: 50 },
                }
            );

            const rawMessages = response.data?.messages || [];

            const messages: ChatMessage[] = rawMessages.map((m: any) => ({
                id: String(m.id),
                from: m.from?.user_id == sellerId ? 'seller' : 'buyer',
                text: m.text || m.message_attachments?.[0]?.text || '',
                attachments: (m.message_attachments || [])
                    .filter((a: any) => a.filename)
                    .map((a: any) => ({ url: a.original_filename || a.filename, type: 'file' })),
                createdAt: m.date_created || new Date().toISOString(),
            }));

            return {
                messages,
                buyerName: response.data?.conversation?.other_user?.nickname,
                buyerNickname: response.data?.conversation?.other_user?.nickname,
                supported: true,
                marketplaceName: 'Mercado Livre',
                packId: String(packId),
            };
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`[ML Messages] Failed to get messages for pack ${packId}: ${detail}`);
            throw new Error(`Failed to load messages: ${detail}`);
        }
    }

    private async sendMercadoLivreMessage(order: any, marketplace: any, token: any, text: string): Promise<void> {
        const packId = order.marketplaceData?.pack_id
            || order.marketplaceData?.shipping?.id
            || order.externalId;
        const sellerId = token.additionalData?.seller_id || token.additionalData?.user_id;

        if (!packId) throw new NotFoundException('Pack ID not found for this order');

        this.logger.log(`[ML Messages] Sending message to pack ${packId}`);

        try {
            await axios.post(
                `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}`,
                { text, attachments: [] },
                { headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' } }
            );
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`Failed to send message: ${detail}`);
        }
    }

    // ── Shopee ─────────────────────────────────────────────────────────────────

    private async getShopeeMessages(order: any, marketplace: any, token: any): Promise<MessageThread> {
        const shopId = token.additionalData?.shopId || token.shopId;
        const orderSn = order.externalId;

        if (!shopId) throw new Error('ShopId not found in Shopee token');
        if (!orderSn) throw new NotFoundException('External order SN not found');

        const baseUrl = getShopeeBaseUrl();
        const timestamp = Math.floor(Date.now() / 1000);

        // Step 1: Get conversation ID from order
        const convPath = '/sellerchat/get_one_conversation_by_order_sn';
        const convParams = buildSignedParams(convPath, timestamp, token.accessToken, Number(shopId), { order_sn: orderSn });

        this.logger.log(`[Shopee Messages] Fetching conversation for order ${orderSn}`);

        try {
            const convResponse = await axios.get(`${baseUrl}${convPath}`, {
                headers: buildHeaders(),
                params: { ...convParams, access_token: token.accessToken, shop_id: Number(shopId), order_sn: orderSn },
            });

            const conversationId = convResponse.data?.response?.conversation_id;
            if (!conversationId) {
                return { messages: [], supported: true, marketplaceName: 'Shopee', conversationId: undefined };
            }

            // Step 2: Get messages in the conversation
            const msgPath = '/sellerchat/get_message';
            const msgTimestamp = Math.floor(Date.now() / 1000);
            const msgParams = buildSignedParams(msgPath, msgTimestamp, token.accessToken, Number(shopId));

            const msgBody = { conversation_id: conversationId, page_size: 50 };
            const msgResponse = await axios.post(`${baseUrl}${msgPath}`, msgBody, {
                headers: buildHeaders(),
                params: { ...msgParams, access_token: token.accessToken, shop_id: Number(shopId) },
            });

            const rawMessages = msgResponse.data?.response?.messages || [];
            const messages: ChatMessage[] = rawMessages.map((m: any) => ({
                id: String(m.message_id),
                from: m.from_shop_id ? 'seller' : 'buyer',
                text: m.content?.text || '',
                attachments: m.content?.url ? [{ url: m.content.url, type: m.content.file_type || 'image' }] : [],
                createdAt: new Date((m.created_timestamp || 0) * 1000).toISOString(),
            }));

            return {
                messages: messages.reverse(), // newest last
                supported: true,
                marketplaceName: 'Shopee',
                conversationId: String(conversationId),
            };
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`[Shopee Messages] Error for order ${orderSn}: ${detail}`);
            throw new Error(`Failed to load Shopee messages: ${detail}`);
        }
    }

    private async sendShopeeMessage(order: any, marketplace: any, token: any, text: string): Promise<void> {
        const shopId = token.additionalData?.shopId || token.shopId;
        const orderSn = order.externalId;

        if (!shopId) throw new Error('ShopId not found in Shopee token');

        const baseUrl = getShopeeBaseUrl();
        const timestamp = Math.floor(Date.now() / 1000);

        // Get conversation ID first
        const convPath = '/sellerchat/get_one_conversation_by_order_sn';
        const convParams = buildSignedParams(convPath, timestamp, token.accessToken, Number(shopId), { order_sn: orderSn });

        const convResponse = await axios.get(`${baseUrl}${convPath}`, {
            headers: buildHeaders(),
            params: { ...convParams, access_token: token.accessToken, shop_id: Number(shopId), order_sn: orderSn },
        });

        const conversationId = convResponse.data?.response?.conversation_id;
        if (!conversationId) throw new Error('Could not find Shopee conversation for this order');

        const msgPath = '/sellerchat/send_message';
        const msgTimestamp = Math.floor(Date.now() / 1000);
        const msgParams = buildSignedParams(msgPath, msgTimestamp, token.accessToken, Number(shopId));

        const body = {
            conversation_id: conversationId,
            message_type: 'text',
            content: { text },
        };

        await axios.post(`${baseUrl}${msgPath}`, body, {
            headers: buildHeaders(),
            params: { ...msgParams, access_token: token.accessToken, shop_id: Number(shopId) },
        });

        this.logger.log(`[Shopee Messages] Message sent to conversation ${conversationId}`);
    }

    // ── Image sending ──────────────────────────────────────────────────────────

    async sendImage(orderId: string, imageBase64: string, mimeType: string): Promise<{ success: boolean }> {
        if (!imageBase64) throw new BadRequestException('imageBase64 is required');

        const { order, marketplace, token } = await this.resolveContext(orderId);
        const tag = (marketplace.tag || '').toLowerCase();

        switch (tag) {
            case 'mercadolivre':
                await this.sendMercadoLivreImage(order, marketplace, token, imageBase64, mimeType);
                return { success: true };
            case 'shopee':
                await this.sendShopeeImage(order, marketplace, token, imageBase64, mimeType);
                return { success: true };
            default:
                throw new BadRequestException(`Image messages not supported for marketplace "${marketplace.name}".`);
        }
    }

    private async sendMercadoLivreImage(order: any, marketplace: any, token: any, imageBase64: string, mimeType: string): Promise<void> {
        const packId = order.marketplaceData?.pack_id
            || order.marketplaceData?.shipping?.id
            || order.externalId;
        const sellerId = token.additionalData?.seller_id || token.additionalData?.user_id;

        if (!packId) throw new NotFoundException('Pack ID not found for this order');

        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const ext = mimeType.includes('png') ? 'png' : 'jpg';

        const form = new FormData();
        form.append('message', JSON.stringify({ text: '', attachments: [] }), { contentType: 'application/json' });
        form.append('file', imageBuffer, { filename: `image.${ext}`, contentType: mimeType });

        this.logger.log(`[ML Messages] Sending image to pack ${packId}`);

        try {
            await axios.post(
                `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${sellerId}`,
                form,
                {
                    headers: {
                        Authorization: `Bearer ${token.accessToken}`,
                        ...form.getHeaders(),
                    },
                }
            );
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`Failed to send ML image: ${detail}`);
        }
    }

    private async sendShopeeImage(order: any, marketplace: any, token: any, imageBase64: string, mimeType: string): Promise<void> {
        const shopId = token.additionalData?.shopId || token.shopId;
        const orderSn = order.externalId;

        if (!shopId) throw new Error('ShopId not found in Shopee token');

        const baseUrl = getShopeeBaseUrl();
        const timestamp = Math.floor(Date.now() / 1000);

        // Step 1: Get conversation ID
        const convPath = '/sellerchat/get_one_conversation_by_order_sn';
        const convParams = buildSignedParams(convPath, timestamp, token.accessToken, Number(shopId), { order_sn: orderSn });
        const convResponse = await axios.get(`${baseUrl}${convPath}`, {
            headers: buildHeaders(),
            params: { ...convParams, access_token: token.accessToken, shop_id: Number(shopId), order_sn: orderSn },
        });

        const conversationId = convResponse.data?.response?.conversation_id;
        if (!conversationId) throw new Error('Could not find Shopee conversation for this order');

        // Step 2: Upload image
        const uploadPath = '/sellerchat/upload_image';
        const uploadTimestamp = Math.floor(Date.now() / 1000);
        const uploadParams = buildSignedParams(uploadPath, uploadTimestamp, token.accessToken, Number(shopId));

        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const form = new FormData();
        form.append('file', imageBuffer, { filename: `image.${ext}`, contentType: mimeType });

        const uploadResponse = await axios.post(`${baseUrl}${uploadPath}`, form, {
            headers: { ...buildHeaders(), ...form.getHeaders() },
            params: { ...uploadParams, access_token: token.accessToken, shop_id: Number(shopId) },
        });

        const imageUrl = uploadResponse.data?.response?.url;
        if (!imageUrl) throw new Error('Shopee image upload returned no URL');

        // Step 3: Send image message
        const msgPath = '/sellerchat/send_message';
        const msgTimestamp = Math.floor(Date.now() / 1000);
        const msgParams = buildSignedParams(msgPath, msgTimestamp, token.accessToken, Number(shopId));

        await axios.post(`${baseUrl}${msgPath}`, {
            conversation_id: conversationId,
            message_type: 'image',
            content: { image_url: imageUrl },
        }, {
            headers: buildHeaders(),
            params: { ...msgParams, access_token: token.accessToken, shop_id: Number(shopId) },
        });

        this.logger.log(`[Shopee Messages] Image sent to conversation ${conversationId}`);
    }

    // ── Shared ─────────────────────────────────────────────────────────────────

    private async resolveContext(orderId: string) {
        const order = await this.orderModel.findById(orderId).lean().exec();
        if (!order) throw new NotFoundException(`Order ${orderId} not found`);

        const marketplace = await this.marketplaceModel
            .findById((order as any).marketplaceId)
            .lean()
            .exec();
        if (!marketplace) throw new NotFoundException(`Marketplace not found for order ${orderId}`);

        const token = await this.auth.ensureValidToken(String(marketplace._id));
        if (!token?.accessToken) throw new NotFoundException(`No active token for marketplace ${marketplace.name}`);

        return { order, marketplace, token };
    }
}
