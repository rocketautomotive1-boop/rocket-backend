import { Reflector } from '@nestjs/core';
import { NotificationChannelRegistry } from './notification-channel.registry';
import { NOTIFICATION_CHANNEL_METADATA } from './notification-channel.interface';

class FakePush { key = 'push'; retriable = true; async send() {} }
class NotAChannel {}

function makeDiscovery(instances: any[]) {
  return { getProviders: () => instances.map((instance) => ({ instance })) } as any;
}

describe('NotificationChannelRegistry', () => {
  function build(instances: any[]) {
    const reflector = new Reflector();
    instances.forEach((i) => {
      const key = i instanceof FakePush ? 'push' : undefined;
      if (key) Reflect.defineMetadata(NOTIFICATION_CHANNEL_METADATA, key, i.constructor);
    });
    const reg = new NotificationChannelRegistry(makeDiscovery(instances), reflector);
    reg.onModuleInit();
    return reg;
  }

  it('registra canais decorados e resolve por key', () => {
    const push = new FakePush();
    const reg = build([push, new NotAChannel()]);
    expect(reg.get('push')).toBe(push);
    expect(reg.has('push')).toBe(true);
  });

  it('retorna undefined para canal desconhecido', () => {
    const reg = build([new FakePush()]);
    expect(reg.get('email' as any)).toBeUndefined();
    expect(reg.has('email' as any)).toBe(false);
  });
});
