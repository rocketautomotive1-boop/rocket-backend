import { NotificationRequested } from '../contracts/notification-requested.event';
import {
  AudienceSpec, NotificationCategory, NotificationChannelKey, NotificationSeverity,
} from '../contracts/notification.types';

interface CategoryDefaults {
  channels: NotificationChannelKey[];
  audience: AudienceSpec;
}

const DEFAULTS: Record<NotificationCategory, CategoryDefaults> = {
  order:       { channels: ['persist', 'push', 'websocket'], audience: { kind: 'all-admins' } },
  question:    { channels: ['persist', 'push', 'websocket'], audience: { kind: 'all-admins' } },
  stock:       { channels: ['persist', 'push', 'websocket'], audience: { kind: 'all-admins' } },
  marketplace: { channels: ['persist', 'push', 'websocket'], audience: { kind: 'all-admins' } },
  system:      { channels: ['persist', 'push', 'websocket'], audience: { kind: 'all-admins' } },
};

const FALLBACK: CategoryDefaults = DEFAULTS.system;

/** Preenche channels/audience/severity/deduplicationKey ausentes. Função pura. */
export function applyNotificationDefaults(
  req: NotificationRequested,
): Required<Pick<NotificationRequested, 'channels' | 'audience' | 'severity' | 'deduplicationKey'>> &
  NotificationRequested {
  const def = DEFAULTS[req.aggregateType] ?? FALLBACK;
  const severity: NotificationSeverity = req.severity ?? 'info';
  const deduplicationKey =
    req.deduplicationKey ?? `${req.type}:${req.aggregateType}:${req.aggregateId}`;
  return {
    ...req,
    channels: req.channels ?? def.channels,
    audience: req.audience ?? def.audience,
    severity,
    deduplicationKey,
  };
}
