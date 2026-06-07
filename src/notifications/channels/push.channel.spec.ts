import axios from 'axios';
import { PushChannel } from './push.channel';
import { NotificationView, Recipient } from '../contracts/notification.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const view: NotificationView = {
  id: 'n1', category: 'order', type: 'order.processed', title: 'T', body: 'B',
  severity: 'success', data: { actionRoute: '/x' }, createdAt: new Date(),
};

describe('PushChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('key=push, retriable=true', () => {
    const ch = new PushChannel();
    expect(ch.key).toBe('push');
    expect(ch.retriable).toBe(true);
  });

  it('envia um batch com todos os tokens dos recipients', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200 } as any);
    const recipients: Recipient[] = [
      { userId: 'u1', pushTokens: ['t1', 't2'] },
      { userId: 'u2', pushTokens: ['t3'] },
    ];
    await new PushChannel().send(view, recipients);
    const [, body] = mockedAxios.post.mock.calls[0];
    expect(Array.isArray(body)).toBe(true);
    expect((body as any[]).map((m) => m.to)).toEqual(['t1', 't2', 't3']);
    expect((body as any[])[0].data.notificationId).toBe('n1');
  });

  it('não chama axios quando não há tokens', async () => {
    await new PushChannel().send(view, [{ userId: 'u1', pushTokens: [] }]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
