import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

import { BaileysWhatsAppProvider } from './providers/baileys-whatsapp.provider';
import { WhatsAppTransportService } from './whatsapp-transport.service';
import { WhatsAppQueueWorker } from './workers/whatsapp-queue.worker';
import { WhatsAppController } from './whatsapp.controller';
import { WHATSAPP_PORT } from './whatsapp.port';

/**
 * Subsistema de transporte WhatsApp — autocontido e neutro.
 *
 * Não importa nenhum módulo de domínio (order/stock/marketplace/notifications).
 * Expõe apenas WHATSAPP_PORT; emite WHATSAPP_INBOUND_EVENT para mensagens recebidas.
 * O broker (NotificationsModule) consome WHATSAPP_PORT — dependência aponta só para cá.
 */
@Module({
  imports: [ConfigModule],
  controllers: [WhatsAppController],
  providers: [
    // Provider: stub leve quando WHATSAPP_ENABLED=false (não abre socket).
    {
      provide: BaileysWhatsAppProvider,
      useFactory: (configService: ConfigService, eventEmitter: EventEmitter2) => {
        const enabled = configService.get<string>('WHATSAPP_ENABLED', 'true') !== 'false';
        if (!enabled) {
          return {
            isConnected: () => false,
            sendMessage: async () => {},
            initialize: async () => {},
            destroy: async () => {},
            reconnect: async () => {},
            getStatus: async () => ({ connected: false, message: 'WhatsApp disabled' }),
            listGroups: async () => [],
            getQRCode: async () => null,
          } as any;
        }
        return new BaileysWhatsAppProvider(configService, eventEmitter);
      },
      inject: [ConfigService, EventEmitter2],
    },
    WhatsAppQueueWorker,
    {
      provide: WHATSAPP_PORT,
      useFactory: (
        provider: BaileysWhatsAppProvider,
        configService: ConfigService,
        amqp: AmqpConnection,
      ) => new WhatsAppTransportService(provider, configService, amqp),
      inject: [BaileysWhatsAppProvider, ConfigService, AmqpConnection],
    },
  ],
  exports: [WHATSAPP_PORT],
})
export class WhatsAppModule {}
