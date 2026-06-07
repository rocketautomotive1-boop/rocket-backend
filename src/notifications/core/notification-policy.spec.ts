import { applyNotificationDefaults } from './notification-policy';

describe('applyNotificationDefaults', () => {
  it('aplica channels e audience default para order', () => {
    const r = applyNotificationDefaults({
      type: 'order.processed', aggregateType: 'order', aggregateId: '1',
      title: 't', body: 'b',
    });
    expect(r.channels).toEqual(['persist', 'push', 'websocket']);
    expect(r.audience).toEqual({ kind: 'all-admins' });
    expect(r.severity).toBe('info');
  });

  it('preserva channels e audience explícitos', () => {
    const r = applyNotificationDefaults({
      type: 'x', aggregateType: 'system', aggregateId: '1', title: 't', body: 'b',
      channels: ['push'], audience: { kind: 'user', userId: 'u1' }, severity: 'error',
    });
    expect(r.channels).toEqual(['push']);
    expect(r.audience).toEqual({ kind: 'user', userId: 'u1' });
    expect(r.severity).toBe('error');
  });

  it('deriva deduplicationKey quando ausente', () => {
    const r = applyNotificationDefaults({
      type: 'order.processed', aggregateType: 'order', aggregateId: '42',
      title: 't', body: 'b',
    });
    expect(r.deduplicationKey).toBe('order.processed:order:42');
  });

  it('usa fallback de categoria desconhecida (system defaults)', () => {
    const r = applyNotificationDefaults({
      type: 'x', aggregateType: 'marketplace', aggregateId: '1', title: 't', body: 'b',
    });
    expect(r.channels).toEqual(['persist', 'push', 'websocket']);
    expect(r.audience).toEqual({ kind: 'all-admins' });
  });
});
