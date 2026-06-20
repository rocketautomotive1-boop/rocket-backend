import { WhatsappChannel } from './whatsapp.channel';
import { NotificationView } from '../contracts/notification.types';

const view: NotificationView = {
  id: 'n1', category: 'order', type: 'order.sale', title: 'Nova venda', body: 'Pedido X',
  severity: 'success', data: { externalId: 'ML-1' }, createdAt: new Date(),
};

describe('WhatsappChannel', () => {
  it('key=whatsapp, retriable=false (retry no transporte)', () => {
    const ch = new WhatsappChannel({ enqueue: jest.fn() } as any);
    expect(ch.key).toBe('whatsapp');
    expect(ch.retriable).toBe(false);
  });

  it('enfileira o body já formatado via WHATSAPP_PORT', async () => {
    const port = { enqueue: jest.fn().mockResolvedValue(undefined) };
    await new WhatsappChannel(port as any).send(view, []);
    expect(port.enqueue).toHaveBeenCalledWith({
      content: 'Pedido X',
      correlationId: 'ML-1',
      metadata: { externalId: 'ML-1' },
    });
  });
});
