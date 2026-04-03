import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { WhatsAppCommandRouter } from './whatsapp-command.router';
import { WhatsAppCommandDispatcher } from './whatsapp-command.dispatcher';

interface WhatsAppMessageEvent {
  from: string;
  body: string;
  groupId: string;
}

@Injectable()
export class WhatsAppCommandListener {
  private readonly logger = new Logger(WhatsAppCommandListener.name);
  private readonly ignoreNumbers: string[];

  constructor(
    private readonly router: WhatsAppCommandRouter,
    private readonly dispatcher: WhatsAppCommandDispatcher,
    private readonly baileys: BaileysWhatsAppProvider,
    private readonly configService: ConfigService,
  ) {
    // WHATSAPP_ADMIN_NUMBERS_IGNORE=5511888888888 — silencia números específicos
    const rawIgnore = this.configService.get<string>('WHATSAPP_ADMIN_NUMBERS_IGNORE', '');
    this.ignoreNumbers = rawIgnore.split(',').map(n => n.trim()).filter(Boolean);
  }

  @OnEvent('whatsapp.message.received', { async: true })
  async handle(event: WhatsAppMessageEvent): Promise<void> {
    const { from, body, groupId } = event;

    const senderNumber = from.split('@')[0];
    if (this.ignoreNumbers.includes(senderNumber)) return;

    const intent = this.router.route(body);

    const reply = await this.dispatcher.execute(intent);
    if (!reply) return; // UNKNOWN → silencioso

    try {
      await this.baileys.sendMessage(groupId, reply);
    } catch (err) {
      this.logger.error(`[Bot] Failed to send reply: ${err.message}`);
    }
  }
}
