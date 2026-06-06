import 'reflect-metadata';
import { RegisterWebhookAdapter, WEBHOOK_ADAPTER_METADATA } from './webhook-adapter.interface';

describe('RegisterWebhookAdapter', () => {
  it('grava o nome do marketplace na metadata da classe', () => {
    @RegisterWebhookAdapter('shopee')
    class FakeAdapter {}
    const meta = Reflect.getMetadata(WEBHOOK_ADAPTER_METADATA, FakeAdapter);
    expect(meta).toBe('shopee');
  });
});
