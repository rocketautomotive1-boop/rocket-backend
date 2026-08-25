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
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Namespace, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { FiscalDocumentModel, FiscalDocumentDocument } from '../fiscal/schemas/fiscal.schema';
import {
    FiscalNfeAuthorizedEvent,
    FiscalNfeRejectedEvent,
    FiscalNfeErrorEvent,
    FISCAL_EVENTS,
} from '../fiscal/events/fiscal.events';

interface NfeStatusPayload {
    orderId: string;
    status: 'AUTHORIZED' | 'REJECTED' | 'ERROR';
    accessKey?: string;
    message?: string;
}

/**
 * Notifica em tempo real o resultado da emissão de NFe, que agora é assíncrona
 * (POST /fiscal/nfe/emit/:orderId enfileira e responde 202 na hora — ver
 * FiscalIssuanceRequestService). Mesmo padrão de DiscoveryGateway: sala por
 * orderId + catch-up via FiscalDocumentModel para quem se inscreve depois do
 * evento já ter disparado.
 */
@Injectable()
@WebSocketGateway({
    namespace: '/fiscal',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
})
export class FiscalGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(FiscalGateway.name);

    @WebSocketServer()
    server: Namespace;

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private readonly fiscalDocumentModel: Model<FiscalDocumentDocument>,
    ) { }

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribeToOrder')
    async handleSubscribeToOrder(
        @MessageBody() data: { orderId: string },
        @ConnectedSocket() client: Socket,
    ) {
        const { orderId } = data;
        if (!orderId) {
            this.logger.warn(`Client ${client.id} tried to subscribe without orderId`);
            return;
        }

        client.join(`order_${orderId}`);
        client.emit('subscribed', { orderId });
        this.logger.log(`Client ${client.id} subscribed to order ${orderId}`);

        // Catch-up: se a NFe já terminou de processar antes do subscribe chegar, emite agora.
        const doc = await this.fiscalDocumentModel
            .findOne({ $or: [{ orderId }, { order: orderId }] })
            .sort({ createdAt: -1 })
            .select('status accessKey rejectionReason')
            .lean()
            .exec();

        if (!doc) return;

        if (doc.status === 'AUTHORIZED') {
            client.emit('nfeStatus', { orderId, status: 'AUTHORIZED', accessKey: doc.accessKey } as NfeStatusPayload);
        } else if (doc.status === 'REJECTED' || doc.status === 'ERROR') {
            client.emit('nfeStatus', {
                orderId,
                status: doc.status,
                message: doc.rejectionReason,
            } as NfeStatusPayload);
        }
    }

    @OnEvent(FISCAL_EVENTS.NFE_AUTHORIZED)
    handleAuthorized(event: FiscalNfeAuthorizedEvent) {
        this.broadcast(event.orderId, { orderId: event.orderId, status: 'AUTHORIZED', accessKey: event.accessKey });
    }

    @OnEvent(FISCAL_EVENTS.NFE_REJECTED)
    handleRejected(event: FiscalNfeRejectedEvent) {
        this.broadcast(event.orderId, { orderId: event.orderId, status: 'REJECTED', message: event.rejectionReason });
    }

    @OnEvent(FISCAL_EVENTS.NFE_ERROR)
    handleError(event: FiscalNfeErrorEvent) {
        this.broadcast(event.orderId, { orderId: event.orderId, status: 'ERROR', message: event.message });
    }

    private broadcast(orderId: string | null, payload: NfeStatusPayload) {
        if (!orderId) return;

        const roomSize = this.server.adapter?.rooms?.get(`order_${orderId}`)?.size ?? 0;
        if (roomSize === 0) {
            this.logger.debug(`No subscribers for order ${orderId} — will catch up on subscribe`);
            return;
        }

        this.logger.debug(`Emitting nfeStatus for order ${orderId}: ${payload.status} (${roomSize} subscribers)`);
        this.server.to(`order_${orderId}`).emit('nfeStatus', payload);
    }
}
