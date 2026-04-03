import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { OrderService } from '../../order/order.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';

export interface WebhookReceivedEvent {
    marketplace: string;
    topic: string;
    payload: any;
}

const ORDER_TOPICS: Record<string, Set<string>> = {
    mercadolivre: new Set(['orders_v2']),
    shopee: new Set(['order']),
    amazon: new Set(['order-notification']),
    magalu: new Set(['orders']),
    b2w: new Set(['orders']),
    viavarejo: new Set([
        'order.created',
        'order.updated',
        'order.shipped',
        'order.delivered',
        'order.cancelled',
    ]),
    yampi: new Set(['order']),
    aliexpress: new Set(['trade']),
};

const QUESTION_TOPICS: Record<string, Set<string>> = {
    mercadolivre: new Set(['questions']),
};

@Injectable()
export class WebhookOrderDispatcher {
    private readonly logger = new Logger(WebhookOrderDispatcher.name);

    constructor(
        @Inject(forwardRef(() => OrderService))
        private readonly orderService: OrderService,
        @Inject(forwardRef(() => MarketplaceService))
        private readonly marketplaceService: MarketplaceService,
        @Inject(forwardRef(() => MercadoLivreAuthAdapter))
        private readonly mlAuth: MercadoLivreAuthAdapter,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    @OnEvent('webhook.received', { async: true })
    async handleWebhook(event: WebhookReceivedEvent): Promise<void> {
        const { marketplace, topic, payload } = event;

        try {
            // Order dispatch
            if (ORDER_TOPICS[marketplace]?.has(topic)) {
                await this.dispatchOrder(marketplace, topic, payload);
                return;
            }

            // Question dispatch: trigger sync + notification
            if (QUESTION_TOPICS[marketplace]?.has(topic)) {
                this.eventEmitter.emit('question.sync_requested', { marketplace, payload });

                this.emitNotification(
                    'question',
                    `Nova Pergunta - ${this.marketplaceLabel(marketplace)}`,
                    'Toque para visualizar e responder',
                    { type: 'question', marketplace, actionRoute: '/(drawer)/questions' },
                );
            }
        } catch (err) {
            this.logger.error(
                `[Dispatcher] Error handling webhook ${marketplace}/${topic}: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }
    }

    private async dispatchOrder(marketplace: string, topic: string, payload: any): Promise<void> {
        const resource: string = payload.resource || '';
        const mkt = await this.marketplaceService.findByTag(marketplace);
        if (!mkt) {
            this.logger.warn(`[Dispatcher] Marketplace not found for tag: ${marketplace}`);
            return;
        }
        const marketplaceId = mkt._id.toString();

        // ML pode enviar resource como "/packs/{packId}" — precisa expandir para order IDs reais
        if (marketplace === 'mercadolivre' && resource.startsWith('/packs/')) {
            const packId = resource.split('/').pop();
            const orderIds = await this.expandMlPack(packId);
            if (!orderIds.length) {
                this.logger.warn(`[Dispatcher] Pack ${packId} expanded to 0 orders`);
                return;
            }
            this.logger.log(`[Dispatcher] Pack ${packId} expanded to orders: ${orderIds.join(', ')}`);
            for (const orderId of orderIds) {
                await this.orderService.enqueueSyncOrder(orderId, marketplaceId, 'webhook');
                this.emitOrderNotification(orderId, marketplace, marketplaceId, mkt.name);
            }
            return;
        }

        const externalId = this.extractExternalId(marketplace, topic, payload);
        if (!externalId) {
            this.logger.warn(`[Dispatcher] Could not extract externalId from ${marketplace}/${topic}`);
            return;
        }

        this.logger.log(`[Dispatcher] Order webhook ${marketplace}/${topic} → externalId=${externalId}, marketplaceId=${marketplaceId}`);
        await this.orderService.enqueueSyncOrder(externalId, marketplaceId, 'webhook');
        this.emitOrderNotification(externalId, marketplace, marketplaceId, mkt.name);
    }

    private async expandMlPack(packId: string): Promise<string[]> {
        try {
            const token = await this.mlAuth.getValidToken('Mercado Livre');
            const me = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const sellerId = me.data.id;
            const res = await axios.get('https://api.mercadolibre.com/orders/search', {
                headers: { Authorization: `Bearer ${token}` },
                params: { seller: sellerId, pack: packId },
            });
            return (res.data.results || []).map((o: any) => String(o.id));
        } catch (err) {
            this.logger.error(`[Dispatcher] Failed to expand ML pack ${packId}: ${err.message}`);
            return [];
        }
    }

    private emitOrderNotification(externalId: string, marketplace: string, marketplaceId: string, marketplaceName: string): void {
        this.emitNotification(
            'order',
            `Nova Venda - ${marketplaceName || this.marketplaceLabel(marketplace)}`,
            `Pedido ${externalId} recebido`,
            { type: 'order', externalId, marketplace, marketplaceId, actionRoute: '/(drawer)/orders' },
        );
    }

    private extractExternalId(marketplace: string, topic: string, payload: any): string | null {
        try {
            switch (marketplace) {
                case 'mercadolivre':
                    // payload.resource = "/orders/123456789"
                    return (payload.resource || '').split('/').pop() || null;

                case 'shopee':
                    return payload.data?.ordersn || payload.data?.order_sn || null;

                case 'amazon':
                    // SNS wraps the message; actual order data may be in Message (JSON string)
                    if (payload.Message) {
                        try {
                            const msg = JSON.parse(payload.Message);
                            return msg.AmazonOrderId || msg.orderId || null;
                        } catch {
                            return null;
                        }
                    }
                    return payload.AmazonOrderId || payload.orderId || null;

                case 'viavarejo':
                    return payload.data?.id?.toString() || null;

                case 'magalu':
                    return payload.data?.id?.toString() || payload.order_id?.toString() || null;

                case 'b2w':
                    return payload.data?.id?.toString() || payload.order?.id?.toString() || null;

                case 'yampi':
                    return payload.data?.id?.toString() || payload.resource?.id?.toString() || null;

                case 'aliexpress':
                    return payload.data?.order_id?.toString() || null;

                default:
                    return null;
            }
        } catch {
            return null;
        }
    }

    private emitNotification(
        category: string,
        title: string,
        body: string,
        data: Record<string, any>,
    ): void {
        this.eventEmitter.emit('notification.send', {
            category,
            title,
            body,
            data,
            channels: ['push', 'websocket', 'persist'],
            severity: category === 'order' ? 'success' : 'info',
            deduplicationKey: `${category}:${data.marketplace}:${data.externalId || Date.now()}`,
        });
    }

    private marketplaceLabel(tag: string): string {
        const labels: Record<string, string> = {
            mercadolivre: 'Mercado Livre',
            shopee: 'Shopee',
            amazon: 'Amazon',
            magalu: 'Magazine Luiza',
            b2w: 'B2W',
            viavarejo: 'Via Varejo',
            yampi: 'Yampi',
            aliexpress: 'AliExpress',
            olx: 'OLX',
        };
        return labels[tag] || tag;
    }
}
