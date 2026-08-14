import {
  AudienceSpec, NotificationCategory, NotificationChannelKey,
  NotificationSeverity, NotificationSource,
} from './notification.types';

/** Única entrada do pipeline de notificações. */
export interface NotificationRequested {
  type: string;
  aggregateType: NotificationCategory;
  aggregateId: string;
  deduplicationKey?: string;

  title: string;
  body: string;
  severity?: NotificationSeverity;
  data?: Record<string, any>;

  channels?: NotificationChannelKey[];
  audience?: AudienceSpec;
  source?: NotificationSource;
}
