import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';

export interface SyncCompletedEvent {
    productId: string;
    listingId: string;
    externalId: string;
    marketplaceTag: string;
    success: true;
}

export interface SyncFailedEvent {
    productId: string;
    listingId: string;
    errorMessage: string;
    errorClassifier?: string;
    marketplaceTag: string;
    success: false;
}

@Injectable()
@WebSocketGateway({
    namespace: '/sync',
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    transports: ['websocket', 'polling'],
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(SyncGateway.name);

    @WebSocketServer()
    server: Namespace;

    handleConnection(client: Socket) {
        this.logger.debug(`Sync client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.debug(`Sync client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribeToProduct')
    handleSubscribe(
        @MessageBody() data: { productId: string },
        @ConnectedSocket() client: Socket,
    ) {
        if (!data?.productId) return;
        client.join(`product_${data.productId}`);
        client.emit('subscribed', { productId: data.productId });
        this.logger.debug(`Client ${client.id} subscribed to product ${data.productId}`);
    }

    emitSyncCompleted(event: SyncCompletedEvent): void {
        const room = `product_${event.productId}`;
        const size = this.server.adapter?.rooms?.get(room)?.size ?? 0;
        if (size === 0) return;
        this.logger.log(`Emitting sync.completed for product ${event.productId} (${size} subscribers)`);
        this.server.to(room).emit('sync.completed', event);
    }

    emitSyncFailed(event: SyncFailedEvent): void {
        const room = `product_${event.productId}`;
        const size = this.server.adapter?.rooms?.get(room)?.size ?? 0;
        if (size === 0) return;
        this.logger.warn(`Emitting sync.failed for product ${event.productId} (${size} subscribers)`);
        this.server.to(room).emit('sync.failed', event);
    }
}
