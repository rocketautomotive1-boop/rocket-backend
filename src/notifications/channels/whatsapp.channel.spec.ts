jest.mock('uuid', () => ({
  v4: () => 'mock-job-id',
}));

import { WhatsappChannel } from './whatsapp.channel';
import { NotificationView } from '../contracts/notification.types';

const view: NotificationView = {
  id: 'n1', category: 'order', type: 'order.processed', title: 'Nova venda', body: 'Pedido X',
  severity: 'success', data: {}, createdAt: new Date(),
};

describe('WhatsappChannel', () => {
  it('key=whatsapp, retriable=false (delega ao subsistema próprio)', () => {
    const ch = new WhatsappChannel({ sendSystemMessage: jest.fn() } as any);
    expect(ch.key).toBe('whatsapp');
    expect(ch.retriable).toBe(false);
  });

  it('delega ao WhatsAppNotificationService.sendSystemMessage', async () => {
    const wpp = { sendSystemMessage: jest.fn().mockResolvedValue(undefined) };
    await new WhatsappChannel(wpp as any).send(view, []);
    expect(wpp.sendSystemMessage).toHaveBeenCalledWith('Nova venda', 'Pedido X');
  });
});
