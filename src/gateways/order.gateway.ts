import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS } from '../order/events/order.events';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';

@WebSocketGateway({
    namespace: '/orders',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
})
export class OrderGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(OrderGateway.name);

    @WebSocketServer()
    server: Namespace;

    handleConnection(client: Socket) {
        this.logger.log(`Client connected to Order Gateway: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected from Order Gateway: ${client.id}`);
    }

    @SubscribeMessage('subscribeToOrders')
    handleSubscribe(@ConnectedSocket() client: Socket) {
        client.join('order_updates');
        client.emit('subscribed', { channel: 'order_updates' });
        this.logger.log(`Client ${client.id} subscribed to order_updates`);
    }

    @OnEvent(ORDER_EVENTS.PROCESSED)
    handleOrderProcessed(event: any) {
        this.server.to('order_updates').emit('orderProcessed', {
            orderId: event.orderId,
            externalId: event.externalId,
            marketplaceId: event.marketplaceId,
            marketplaceName: event.marketplaceName,
            totalAmount: event.totalAmount,
            itemCount: event.items?.length || 0,
            triggeredBy: event.triggeredBy,
            timestamp: new Date(),
        });
        this.logger.debug(`[OrderGateway] Broadcasted orderProcessed: ${event.externalId}`);
    }

    @OnEvent(ORDER_EVENTS.SYNC_COMPLETED)
    handleSyncCompleted(event: any) {
        this.server.to('order_updates').emit('orderSyncCompleted', {
            externalId: event.externalId,
            marketplaceId: event.marketplaceId,
            timestamp: new Date(),
        });
        this.logger.log(`[OrderGateway] Broadcasted orderSyncCompleted: ${event.externalId}`);
    }

    @OnEvent(ORDER_EVENTS.SYNC_FAILED)
    handleSyncFailed(event: any) {
        this.server.to('order_updates').emit('orderSyncFailed', {
            externalId: event.externalId,
            marketplaceId: event.marketplaceId,
            error: event.error,
            timestamp: new Date(),
        });
        this.logger.warn(`[OrderGateway] Broadcasted orderSyncFailed: ${event.externalId} — ${event.error}`);
    }

    @OnEvent(NOTIFICATION_EVENTS.BROADCAST)
    handleNotificationBroadcast(notification: any) {
        this.server.to('order_updates').emit('notification', notification);
        this.logger.debug(`[OrderGateway] Broadcasted notification: ${notification.title}`);
    }
}
