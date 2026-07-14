import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { REMBG_EVENTS, RembgSubscribedEvent } from './rembg.events';

/**
 * Socket.IO gateway (namespace /rembg) used to PUSH job/batch progress to the app
 * (rembg:job:done, rembg:job:failed, rembg:batch:progress, rembg:batch:done). Emissions
 * come from RembgCompletionService. It no longer proxies image processing over a WebSocket
 * RPC — that lossy path was replaced by the durable job pipeline + HTTP result callback.
 */
@WebSocketGateway({
    namespace: '/rembg',
    cors: {
        origin: '*',
    },
    maxHttpBufferSize: 1e8, // 100MB
    allowEIO3: true, // Compatibility with older clients
})
export class RembgGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(RembgGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(private readonly eventEmitter: EventEmitter2) {}

    handleConnection(client: Socket) {
        this.logger.log(`Client connected to Rembg Gateway: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected from Rembg Gateway: ${client.id}`);
    }

    /** The app subscribes to its product's room to receive that product's rembg events. */
    @SubscribeMessage('subscribeToProduct')
    handleSubscribe(
        @MessageBody() payload: { productId: string },
        @ConnectedSocket() client: Socket,
    ): { ok: boolean } {
        const productId = String(payload?.productId ?? '').trim();
        if (productId) {
            client.join(`product_${productId}`);
            // Replay the product's current batch state to this room so a client that
            // missed a `rembg:batch:done` while disconnected reconciles immediately
            // instead of hanging on "processing" forever.
            this.eventEmitter.emit(
                REMBG_EVENTS.SUBSCRIBED,
                { productId } as RembgSubscribedEvent,
            );
        }
        return { ok: !!productId };
    }
}
