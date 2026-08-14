import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../events/notification.events';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer() server: Namespace;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected to Notifications Gateway: ${client.id}`);
  }
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** O app envia seu userId para entrar no room individual. */
  @SubscribeMessage('subscribeToNotifications')
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { userId?: string }) {
    client.join('all');
    if (body?.userId) client.join(`user_${body.userId}`);
    client.emit('subscribed', { channel: 'notifications' });
  }

  @OnEvent(NOTIFICATION_EVENTS.BROADCAST)
  handleBroadcast(payload: any) {
    const userIds: string[] = payload.userIds ?? [];
    if (userIds.length === 0) {
      this.server.to('all').emit('notification', payload);
    } else {
      for (const uid of userIds) this.server.to(`user_${uid}`).emit('notification', payload);
    }
    this.logger.debug(`[NotificationsGateway] broadcast: ${payload.title} → ${userIds.length || 'all'}`);
  }
}
