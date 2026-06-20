/**
 * Porta pública do subsistema de transporte WhatsApp.
 *
 * É a ÚNICA superfície que outros módulos (ex.: notifications) podem consumir.
 * O transporte não conhece Order/Stock/Pricing — recebe um destino + texto e envia.
 */
export const WHATSAPP_PORT = Symbol('WHATSAPP_PORT');

export interface WhatsAppStatus {
  connected: boolean;
  phoneNumber?: string;
  message?: string;
}

export interface WhatsAppGroup {
  id: string;
  name: string;
  participantCount: number;
}

export interface WhatsAppPort {
  /**
   * Enfileira o envio de um texto (entrega garantida via fila + retry + DLQ).
   * Fire-and-forget do ponto de vista do chamador.
   */
  enqueue(message: WhatsAppOutboundMessage): Promise<void>;

  /**
   * Envia um texto imediatamente, sem passar pela fila (request-reply do bot,
   * onde a resposta precisa ser síncrona). Lança se não conectado.
   */
  sendNow(destination: string, text: string): Promise<void>;

  getStatus(): Promise<WhatsAppStatus>;
  listGroups(): Promise<WhatsAppGroup[]>;
  getQRCode(): Promise<string | null>;
}

export interface WhatsAppOutboundMessage {
  /** Grupo (@g.us) ou telefone. Se omitido, usa WHATSAPP_GROUP_ID. */
  destination?: string;
  content: string;
  /** Correlação opcional para auditoria/entrega (ex.: orderId). */
  correlationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Evento neutro emitido pelo transporte quando chega uma mensagem do grupo.
 * O broker (notifications) consome para rotear comandos do bot.
 */
export const WHATSAPP_INBOUND_EVENT = 'whatsapp.inbound';

export interface WhatsAppInboundEvent {
  from: string;
  body: string;
  groupId: string;
}
