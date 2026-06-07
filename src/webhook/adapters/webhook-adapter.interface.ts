import { SetMetadata } from '@nestjs/common';

export const WEBHOOK_ADAPTER_METADATA = 'webhook:adapter:marketplace';

export type WebhookKind = 'order' | 'order_pack' | 'question' | 'ignore';

export interface WebhookContext {
  readonly marketplace: string;
  readonly topic: string;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody?: Buffer;
  readonly payload: any;
}

export interface NormalizedWebhook {
  kind: WebhookKind;
  eventId: string;
  externalId?: string;
  resource?: string;
  raw: unknown;
}

export type SignatureScheme =
  | { type: 'none' }
  | {
      type: 'hmac-sha256';
      header: string;
      secretKey: string;
      baseString: 'rawBody' | ((ctx: WebhookContext) => string);
    }
  | { type: 'shared-token'; header: string; secretKey: string }
  | { type: 'aws-sns' };

export interface WebhookAdapter {
  readonly marketplace: string;
  readonly signatureScheme: SignatureScheme;
  parse(ctx: WebhookContext): NormalizedWebhook;
  confirmSubscription?(subscribeUrl: string): Promise<void>;
}

export const RegisterWebhookAdapter = (marketplace: string) =>
  SetMetadata(WEBHOOK_ADAPTER_METADATA, marketplace);
