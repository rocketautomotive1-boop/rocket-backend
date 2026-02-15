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
import { Server, Socket } from 'socket.io';
import * as WebSocket from 'ws';

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

    handleConnection(client: Socket) {
        this.logger.log(`Client connected to Rembg Gateway: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected from Rembg Gateway: ${client.id}`);
    }

    @SubscribeMessage('process-image')
    async handleProcessImage(
        @MessageBody() payload: { metadata: any; fileBase64: string },
        @ConnectedSocket() client: Socket,
    ): Promise<any> {
        this.logger.log(`Processing image request for client ${client.id}`);

        // Debug payload
        if (!payload) {
            this.logger.error('Payload is null or undefined');
            return { status: 'error', message: 'Payload missing' };
        }

        if (payload.metadata) {
            this.logger.debug(`Metadata: ${typeof payload.metadata === 'string' ? payload.metadata : JSON.stringify(payload.metadata)}`);
        }

        if (!payload.fileBase64) {
            this.logger.error('fileBase64 is missing from payload');
            return { status: 'error', message: 'Image data missing' };
        }

        this.logger.debug(`Base64 data received. Length: ${payload.fileBase64.length} chars`);

        return new Promise((resolve, reject) => {
            const pythonWsUrl = process.env.REMBG_WS_URL || 'ws://localhost:5000/ws';
            const serviceWs = new WebSocket(pythonWsUrl);
            let isResolved = false;

            const safeResolve = (val: any) => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(val);
                }
            };

            // Timeout safety
            const timeout = setTimeout(() => {
                this.logger.error(`Timeout waiting for Python Service response (Client ${client.id})`);
                serviceWs.terminate();
                safeResolve({ status: 'error', message: 'Timeout processing image' });
            }, 60000); // 60s timeout

            serviceWs.on('open', () => {
                this.logger.debug(`Connected to Python Service for request ${client.id}`);

                try {
                    // Protocol: 1. Metadata (JSON) -> 2. Image (Binary)
                    const metaStr = typeof payload.metadata === 'string'
                        ? payload.metadata
                        : JSON.stringify(payload.metadata);

                    this.logger.debug(`Sending metadata... ${metaStr.length} chars`);
                    serviceWs.send(metaStr);

                    // Convert Base64 to Buffer
                    this.logger.debug(`Converting Base64 to Buffer...`);
                    const imageBuffer = Buffer.from(payload.fileBase64, 'base64');
                    this.logger.debug(`Sending binary data: ${imageBuffer.length} bytes`);

                    serviceWs.send(imageBuffer);
                    this.logger.debug(`Data sent successfully`);
                } catch (e) {
                    this.logger.error(`Error sending data to Python Service: ${e.message}`);
                    clearTimeout(timeout);
                    serviceWs.close();
                    safeResolve({ status: 'error', message: 'Failed to send data to service' });
                }
            });

            serviceWs.on('message', (data) => {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(data.toString());
                    this.logger.log(`Received response from Python Service: ${response.status}`);
                    safeResolve(response);
                } catch (e) {
                    this.logger.error(`Invalid JSON from Python Service: ${data}`);
                    safeResolve({ status: 'error', message: 'Invalid response from service' });
                } finally {
                    serviceWs.close();
                }
            });

            serviceWs.on('error', (error) => {
                clearTimeout(timeout);
                this.logger.error(`Python Service Socket Error: ${error.message}`);
                safeResolve({ status: 'error', message: 'Internal Service Error' });
            });

            serviceWs.on('close', (code, reason) => {
                this.logger.warn(`Python Service Disconnected. Code: ${code}, Reason: ${reason}`);
                clearTimeout(timeout);
                if (!isResolved) {
                    safeResolve({ status: 'error', message: 'Service closed connection unexpectedly' });
                }
            });
        });
    }
}
