export const NOTIFICATION_EVENTS = {
  REQUESTED: 'notification.requested',
  BROADCAST: 'notification.broadcast',
} as const;

// Re-export para consumidores existentes (questions, gateway)
export type {
  NotificationCategory, NotificationSeverity, NotificationChannelKey,
  NotificationSource, AudienceSpec,
} from '../contracts/notification.types';
export type { NotificationRequested } from '../contracts/notification-requested.event';
