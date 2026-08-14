import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { WhatsAppCommandRouter } from './whatsapp-command.router';
import { WhatsAppCommandDispatcher } from './whatsapp-command.dispatcher';
import { WhatsAppCommandSession } from './whatsapp-command.session';
import {
  WHATSAPP_PORT, WhatsAppPort,
  WHATSAPP_INBOUND_EVENT, WhatsAppInboundEvent,
} from '../../whatsapp/whatsapp.port';

/**
 * Bot inbound: consome o evento neutro do transporte (WHATSAPP_INBOUND_EVENT),
 * resolve a resposta via dispatcher (read-ports) e devolve via WHATSAPP_PORT.
 * Request-reply síncrono — a resposta sai já (sendNow), não pela fila.
 */
@Injectable()
export class WhatsAppCommandListener {
  private readonly logger = new Logger(WhatsAppCommandListener.name);
  private readonly ignoreNumbers: string[];

  constructor(
    private readonly router: WhatsAppCommandRouter,
    private readonly dispatcher: WhatsAppCommandDispatcher,
    private readonly session: WhatsAppCommandSession,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
    private readonly configService: ConfigService,
  ) {
    const rawIgnore = this.configService.get<string>('WHATSAPP_ADMIN_NUMBERS_IGNORE', '');
    this.ignoreNumbers = rawIgnore.split(',').map(n => n.trim()).filter(Boolean);
  }

  @OnEvent(WHATSAPP_INBOUND_EVENT, { async: true })
  async handle(event: WhatsAppInboundEvent): Promise<void> {
    const { from, body, groupId } = event;

    const senderNumber = from.split('@')[0];
    if (this.ignoreNumbers.includes(senderNumber)) return;

    const pendingTerm = this.session.consumePendingProductSearch(senderNumber, body);
    let reply: string | null = null;

    if (pendingTerm !== null) {
      reply = await this.dispatcher.execute('SEARCH_PRODUCT', { searchTerm: pendingTerm });
    } else {
      const intent = this.router.route(body);
      if (intent === 'SEARCH_PRODUCT') {
        const inlineTerm = this.router.extractSearchTerm(body);
        if (inlineTerm) {
          reply = await this.dispatcher.execute(intent, { searchTerm: inlineTerm });
        } else {
          this.session.beginProductSearch(senderNumber);
          reply = await this.dispatcher.execute(intent);
        }
      } else {
        reply = await this.dispatcher.execute(intent);
      }
    }

    if (!reply) return; // UNKNOWN → silencioso

    try {
      await this.whatsapp.sendNow(groupId, reply);
    } catch (err) {
      this.logger.error(`[Bot] Failed to send reply: ${err.message}`);
    }
  }
}
