export const NOTIFICATION_EVENTS = {
  REQUESTED: 'notification.requested',
  SEND: 'notification.send',
  BROADCAST: 'notification.broadcast',
} as const;

export type NotificationChannel = 'persist' | 'push' | 'websocket' | 'email' | 'whatsapp';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export type NotificationSource = 'webhook' | 'reconciliation' | 'sync' | 'manual' | 'retry' | 'system';

export interface NotificationRequestedEvent {
  type: string;
  aggregateType: 'order' | 'question' | 'stock' | 'system' | 'marketplace' | string;
  aggregateId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  channels?: NotificationChannel[];
  severity?: NotificationSeverity;
  deduplicationKey?: string;
  targetUserId?: string;
  source?: NotificationSource | string;
}

