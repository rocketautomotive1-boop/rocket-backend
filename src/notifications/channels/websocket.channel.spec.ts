import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebsocketChannel } from './websocket.channel';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationView } from '../contracts/notification.types';

const view: NotificationView = {
  id: 'n1', category: 'order', type: 'order.processed', title: 'T', body: 'B',
  severity: 'success', data: {}, createdAt: new Date(),
};

describe('WebsocketChannel', () => {
  it('key=websocket, retriable=false', () => {
    const ch = new WebsocketChannel(new EventEmitter2());
    expect(ch.key).toBe('websocket');
    expect(ch.retriable).toBe(false);
  });

  it('emite BROADCAST com a notificação e os userIds-alvo', async () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    await new WebsocketChannel(emitter).send(view, [{ userId: 'u1', pushTokens: [] }]);
    expect(spy).toHaveBeenCalledWith(NOTIFICATION_EVENTS.BROADCAST, expect.objectContaining({
      id: 'n1', title: 'T', userIds: ['u1'],
    }));
  });
});
