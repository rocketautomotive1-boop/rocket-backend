import { SetMetadata } from '@nestjs/common';

export const WEBHOOK_ADAPTER_METADATA = 'webhook:adapter:marketplace';

/**
 * Fonte única dos "kinds" de webhook reconhecidos — cada um mapeia 1:1 a um
 * comando de domínio em webhook.events.ts e a um case em WebhookDispatcher.
 * NÃO redeclarar esta union em outro arquivo (havia 3 cópias divergentes:
 * WebhookKind, DispatchInput.kind e WebhookInboxKind — adicionar um kind novo
 * exigia lembrar de tocar os 3, e cada um usava um "estado de erro/vazio"
 * diferente: 'ignore' aqui vs 'unparseable' nos outros). Downstream deriva
 * daqui via WebhookKindWithParseFailure.
 */
export type WebhookKind = 'order' | 'order_pack' | 'shipment' | 'question' | 'moderation' | 'return' | 'listing_status' | 'ignore';

/**
 * WebhookKind + o estado de falha de parse (payload não reconhecido/corrompido).
 * Usado onde o pipeline downstream do parse() precisa distinguir "adapter viu e
 * decidiu ignorar" (kind: 'ignore') de "não deu nem pra interpretar" ('unparseable') —
 * DispatchInput e o schema de persistência do inbox.
 */
export type WebhookKindWithParseFailure = WebhookKind | 'unparseable';

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
  /**
   * Id do seller NO marketplace (ex.: ML `user_id`) — a conta destino da
   * notificação. Resolvido na borda → accountId interno (multi-client). Ausente
   * em marketplaces que não identificam a conta no payload.
   */
  externalUserId?: string;
  raw: unknown;
}

export type SignatureScheme =
  | { type: 'none' }
  | {
      type: 'hmac-sha256';
      header: string;
      /**
       * Chave da credencial no MarketplaceCredentialsService. Aceita uma função
       * do ctx quando o secret varia por sub-recurso (ex.: Magalu: cada topic de
       * webhook tem sua PRÓPRIA subscription com secret independente — não há
       * um único webhookSecret por marketplace nesse caso).
       */
      secretKey: string | ((ctx: WebhookContext) => string);
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
