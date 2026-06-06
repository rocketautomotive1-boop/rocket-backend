import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationSendEvent } from '../notification-bus.service';
import { NOTIFICATION_EVENTS } from '../events/notification.events';

@Injectable()
export class NotificationRabbitMqConsumer {
    private readonly logger = new Logger(NotificationRabbitMqConsumer.name);

    constructor(private readonly eventEmitter: EventEmitter2) {}

    @RabbitSubscribe({
        exchange: 'rocket.notifications',
        routingKey: 'notification.send',
        queue: 'q.notifications.send',
        queueOptions: { durable: true },
    })
    async handle(event: NotificationSendEvent): Promise<void> {
        this.logger.debug(`[RabbitMQ→Bus] Received notification: ${event.title}`);
        this.eventEmitter.emit(NOTIFICATION_EVENTS.SEND, event);
    }
}
