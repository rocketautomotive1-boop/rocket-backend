import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io'; // Updated import
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({
    namespace: '/discovery',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'], // Allow polling as fallback
})
export class DiscoveryGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(DiscoveryGateway.name);

    @WebSocketServer()
    server: Namespace; // Updated type from Server to Namespace

    handleConnection(client: Socket) {
        this.logger.log(`Client connected to Discovery Gateway: ${client.id}`);
        this.logger.debug(`Client headers: ${JSON.stringify(client.handshake.headers)}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected from Discovery Gateway: ${client.id}`);
    }

    @SubscribeMessage('subscribeToJob')
    handleSubscribeToJob(
        @MessageBody() data: { jobId: string },
        @ConnectedSocket() client: Socket,
    ) {
        const { jobId } = data;
        if (jobId) {
            this.logger.log(`Client ${client.id} subscribing to Discovery Job ${jobId}`);
            client.join(`job_${jobId}`);
            client.emit('subscribed', { jobId });
            this.logger.debug(`Client ${client.id} joined room job_${jobId}`);
        } else {
            this.logger.warn(`Client ${client.id} tried to subscribe without jobId`);
        }
    }

    @OnEvent('queue.job.update')
    handleDiscoveryStatusUpdate(payload: any) {
        const { jobId, status } = payload;
        if (jobId) {
            this.logger.debug(`Emitting discovery status for job ${jobId}: ${status}`);

            // Log room size to verify subscribers
            // When using namespaces, this.server is a Namespace, so we access adapter directly
            const adapter = this.server.adapter;
            const roomSize = adapter?.rooms?.get(`job_${jobId}`)?.size || 0;
            this.logger.debug(`Broadcasting to room job_${jobId} with ${roomSize} subscribers`);

            this.server.to(`job_${jobId}`).emit('discoveryStatus', payload);
        }
    }
}

