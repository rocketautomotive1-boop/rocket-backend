export const NOTIFICATION_EVENTS = {
  REQUESTED: 'notification.requested',
  BROADCAST: 'notification.broadcast',
} as const;

// Re-export conveniente dos contratos canônicos (ingest/translators, gateway, questions)
export type {
  NotificationCategory, NotificationSeverity, NotificationChannelKey,
  NotificationSource, AudienceSpec,
} from '../contracts/notification.types';
export type { NotificationRequested } from '../contracts/notification-requested.event';
