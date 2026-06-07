export type NotificationCategory =
  | 'order' | 'question' | 'stock' | 'system' | 'marketplace';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationChannelKey = 'persist' | 'push' | 'websocket' | 'email' | 'whatsapp';

export type NotificationSource =
  | 'webhook' | 'reconciliation' | 'sync' | 'manual' | 'retry' | 'system';

export type AudienceSpec =
  | { kind: 'user'; userId: string }
  | { kind: 'role'; role: string }
  | { kind: 'all-admins' }
  | { kind: 'broadcast' };

/** Destinatário resolvido pelo AudienceResolver. */
export interface Recipient {
  userId: string;
  pushTokens: string[];
  email?: string;
}

/** Projeção read-only da notificação persistida, passada aos canais. */
export interface NotificationView {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  data: Record<string, any>;
  createdAt: Date;
}
