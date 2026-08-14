import { EmailChannel } from './email.channel';
import { NotificationView } from '../contracts/notification.types';

const view: NotificationView = {
  id: 'n1', category: 'order', type: 'order.processed', title: 'T', body: 'B',
  severity: 'success', data: {}, createdAt: new Date(),
};

describe('EmailChannel', () => {
  it('key=email, retriable=true', () => {
    const ch = new EmailChannel({ sendEmail: jest.fn() } as any);
    expect(ch.key).toBe('email');
    expect(ch.retriable).toBe(true);
  });

  it('envia para cada recipient com email', async () => {
    const email = { sendEmail: jest.fn().mockResolvedValue(true) };
    await new EmailChannel(email as any).send(view, [
      { userId: 'u1', pushTokens: [], email: 'a@x.com' },
      { userId: 'u2', pushTokens: [] }, // sem email — ignora
    ]);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledWith('a@x.com', 'T', 'B');
  });
});
