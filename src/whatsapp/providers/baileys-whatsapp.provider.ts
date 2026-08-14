import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  WhatsAppGroup,
  WhatsAppStatus,
  WHATSAPP_INBOUND_EVENT,
  WhatsAppInboundEvent,
} from '../whatsapp.port';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Transporte WhatsApp via Baileys (WhatsApp Web).
 *
 * Responsabilidade ÚNICA: socket, envio, reconexão, QR, grupos e emissão do
 * evento neutro de mensagem recebida. Não conhece order/pricing/notifications.
 *
 * Setup: npm install @whiskeysockets/baileys pino
 */
@Injectable()
export class BaileysWhatsAppProvider implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BaileysWhatsAppProvider.name);
  private sock: any = null; // WASocket
  private state: any = null;
  private saveCreds: any = null;
  private dataDir: string;
  private currentQR: string | null = null;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly RECONNECT_DELAYS = [3000, 10000, 30000, 60000, 120000]; // ms
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private connected = false; // atualizado pelo connection.update
  private groupId: string;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.dataDir = this.configService.get('WHATSAPP_DATA_DIR') || './whatsapp_data';
    this.groupId = this.configService.get('WHATSAPP_GROUP_ID', '');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.logger.log(`Created WhatsApp data directory: ${this.dataDir}`);
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.initialize();
    } catch (error) {
      this.logger.error(`Failed to initialize Baileys: ${error.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.destroy();
    } catch (error) {
      this.logger.error(`Failed to destroy Baileys: ${error.message}`);
    }
  }

  async initialize(): Promise<void> {
    try {
      // @ts-ignore — import dinâmico evita erro se baileys não está instalado
      const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
      } = await import('@whiskeysockets/baileys');

      // @ts-ignore
      const pino = await import('pino');
      const pinolog = pino.default;

      this.logger.log('Initializing Baileys WhatsApp provider...');

      const authPath = path.join(this.dataDir, 'auth_info_multi');
      const { state: sessionState, saveCreds } = await useMultiFileAuthState(authPath);

      this.state = sessionState;
      this.saveCreds = saveCreds;

      this.sock = makeWASocket({
        auth: sessionState,
        logger: pinolog({ level: 'warn' }),
        browser: ['Rocket Dashboard', 'Safari', '1.0.0'],
        version: (await fetchLatestBaileysVersion()).version,
        retryRequestDelayMs: 100,
        shouldSyncHistoryMessage: () => false,
      });

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQR = qr;
          const qrPath = path.join(this.dataDir, 'qr.txt');
          fs.writeFileSync(qrPath, qr);
          this.logger.warn('⚠️ QR Code gerado. Visite: http://localhost:3000/whatsapp/qr');
        }

        if (connection === 'open') {
          this.logger.log('✅ WhatsApp connected successfully!');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          this.connected = false;

          if (statusCode === DisconnectReason.loggedOut) {
            this.sock = null;
            this.logger.warn('WhatsApp logged out. Please scan QR code again.');
            return;
          }

          // conflict:replaced — outra sessão substituiu esta; não reconectar (evita loop).
          if (statusCode === 409) {
            this.sock = null;
            this.logger.warn(
              '⚠️ Another WhatsApp session replaced this connection (conflict:replaced). ' +
              'Close the other session (browser tab or phone app) and restart the server.',
            );
            return;
          }

          await this.scheduleReconnect();
        }
      });

      this.sock.ev.on('creds.update', this.saveCreds);

      // Mensagens do grupo → evento neutro para o broker (notifications) rotear o bot.
      this.sock.ev.on('messages.upsert', ({ messages, type }: any) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          const remoteJid: string = msg.key?.remoteJid ?? '';
          if (!remoteJid.endsWith('@g.us')) return;
          if (remoteJid !== this.groupId) return;
          if (msg.key?.fromMe) return;

          const from: string = msg.key?.participant ?? '';
          const body: string =
            msg.message?.conversation ??
            msg.message?.extendedTextMessage?.text ??
            '';

          if (!body.trim()) return;

          const event: WhatsAppInboundEvent = { from, body, groupId: remoteJid };
          this.eventEmitter.emit(WHATSAPP_INBOUND_EVENT, event);
        }
      });

      this.logger.log('Baileys initialized. Waiting for connection...');
    } catch (error) {
      this.logger.error(
        `Initialize error: ${error.message}. Make sure '@whiskeysockets/baileys' is installed.`,
      );
      throw error;
    }
  }

  async sendMessage(destination: string, text: string): Promise<void> {
    if (!this.sock || !this.isConnected()) {
      try {
        await this.reconnect();
      } catch (e) {
        throw new Error(`WhatsApp provider not connected: ${e.message}`);
      }
    }

    try {
      const jid = destination.includes('@') ? destination : `${destination}@s.whatsapp.net`;
      const messageId = await this.sock.sendMessage(jid, { text });
      this.logger.debug(`Message sent to ${destination}. ID: ${messageId?.key?.id}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${destination}: ${error.message}`);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected && this.sock !== null;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.isReconnecting) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Manual restart required.`,
      );
      return;
    }

    this.isReconnecting = true;
    const delay = this.RECONNECT_DELAYS[this.reconnectAttempts] ?? 120000;
    this.reconnectAttempts++;

    this.logger.log(
      `Reconnect attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      if (this.sock) {
        try { await this.sock.end(); } catch { }
      }
      this.sock = null;
      await this.initialize();
    } catch (error) {
      this.logger.error(`Reconnect failed: ${error.message}`);
    } finally {
      this.isReconnecting = false;
    }
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    await this.scheduleReconnect();
  }

  async getStatus(): Promise<WhatsAppStatus> {
    if (!this.sock) {
      return { connected: false, message: 'Provider not initialized' };
    }
    try {
      const user = this.sock?.user;
      return {
        connected: this.isConnected(),
        phoneNumber: user?.id?.split('@')?.[0],
        message: this.isConnected() ? 'Connected' : 'Disconnected',
      };
    } catch (error) {
      return { connected: false, message: `Error: ${error.message}` };
    }
  }

  async destroy(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.end();
        this.sock = null;
        this.logger.log('Baileys WhatsApp provider destroyed');
      } catch (error) {
        this.logger.error(`Error destroying Baileys: ${error.message}`);
      }
    }
  }

  async listGroups(): Promise<WhatsAppGroup[]> {
    if (!this.sock || !this.isConnected()) {
      throw new Error('WhatsApp not connected');
    }
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map((g: any) => ({
      id: g.id,
      name: g.subject,
      participantCount: g.participants?.length ?? 0,
    }));
  }

  async getQRCode(): Promise<string | null> {
    if (this.currentQR) return this.currentQR;
    const qrPath = path.join(this.dataDir, 'qr.txt');
    if (fs.existsSync(qrPath)) return fs.readFileSync(qrPath, 'utf-8');
    return null;
  }
}
