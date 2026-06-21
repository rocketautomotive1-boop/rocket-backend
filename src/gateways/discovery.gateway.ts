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
import { ProductDiscoveryDocument, ProductDiscoveryModel } from '../product/schemas/product-discovery.schema';
import { mapDiscoveryDocToAppData } from '../product/dto/discovery-app.mapper';

@Injectable()
@WebSocketGateway({
    namespace: '/discovery',
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
})
export class DiscoveryGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(DiscoveryGateway.name);

    @WebSocketServer()
    server: Namespace;

    constructor(
        @InjectModel(ProductDiscoveryModel.name)
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
    ) {}

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribeToJob')
    async handleSubscribeToJob(
        @MessageBody() data: { jobId: string },
        @ConnectedSocket() client: Socket,
    ) {
        const { jobId } = data;
        if (!jobId) {
            this.logger.warn(`Client ${client.id} tried to subscribe without jobId`);
            return;
        }

        client.join(`job_${jobId}`);
        client.emit('subscribed', { jobId });
        this.logger.log(`Client ${client.id} subscribed to job ${jobId}`);

        // Catch-up: if the job already finished before the client subscribed, emit now
        const doc = await this.discoveryModel
            .findOne({ batchId: jobId })
            .select('status data final sources resolvedCategoryId query error')
            .lean()
            .exec();

        if (!doc) return;

        if (doc.status === 'done') {
            this.logger.log(`Catch-up: job ${jobId} already done — emitting to ${client.id}`);
            // Mesmo contrato normalizado (DiscoveryAppData) do REST e do WS live.
            client.emit('discoveryStatus', {
                jobId,
                status: 'COMPLETED',
                result: mapDiscoveryDocToAppData(doc),
            });
        } else if (doc.status === 'failed') {
            this.logger.log(`Catch-up: job ${jobId} failed — emitting to ${client.id}`);
            client.emit('discoveryStatus', {
                jobId,
                status: 'FAILED',
                error: doc.error,
            });
        }
    }

    @OnEvent('queue.job.update')
    handleDiscoveryStatusUpdate(payload: any) {
        const { jobId, status } = payload;
        if (!jobId) return;

        const roomSize = this.server.adapter?.rooms?.get(`job_${jobId}`)?.size ?? 0;

        if (roomSize === 0) {
            this.logger.debug(`No subscribers for job ${jobId} — will catch up on subscribe`);
            return;
        }

        this.logger.debug(`Emitting discoveryStatus for job ${jobId}: ${status} (${roomSize} subscribers)`);
        this.server.to(`job_${jobId}`).emit('discoveryStatus', payload);
    }
}

