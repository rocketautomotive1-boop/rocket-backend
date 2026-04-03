import { Controller, Get, Logger, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { NotificationReconcilerService } from '../services/notification-reconciler.service';
import * as QRCode from 'qrcode';

/**
 * Controller para operações WhatsApp
 * Expõe endpoint para visualizar QR code e status da conexão
 */
@Controller('notifications/whatsapp')
export class WhatsAppController {
  private logger = new Logger(WhatsAppController.name);

  constructor(
    private baileysProvider: BaileysWhatsAppProvider,
    private reconcilerService: NotificationReconcilerService,
  ) {}

  /**
   * Endpoint para obter QR code
   * GET /notifications/whatsapp/qr
   * Retorna imagem PNG do QR code
   */
  @Get('qr')
  async getQRCode(@Res() res: Response) {
    try {
      const qr = await this.baileysProvider.getQRCode();

      if (!qr) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>WhatsApp QR Code - Rocket</title>
              <style>
                body {
                  font-family: Arial, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  margin: 0;
                }
                .container {
                  background: white;
                  padding: 40px;
                  border-radius: 10px;
                  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                  text-align: center;
                }
                h1 { color: #333; margin-top: 0; }
                p { color: #666; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>⏳ Aguardando QR Code</h1>
                <p>O Baileys está conectando... Por favor, aguarde alguns segundos.</p>
                <p><a href="/notifications/whatsapp/qr">Recarregar</a></p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      // Se for já uma string Base64 do Baileys, decodificar e gerar QR code
      // Baileys retorna a string do QR code para renderizar
      const qrImage = await QRCode.toDataURL(qr, {
        width: 300,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      // Renderizar HTML com imagem do QR code
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>WhatsApp QR Code - Rocket</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
              }
              .container {
                background: white;
                border-radius: 10px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                text-align: center;
              }
              h1 {
                color: #333;
                margin-top: 0;
              }
              .instruction {
                color: #666;
                margin-bottom: 30px;
                font-size: 16px;
              }
              .qr-container {
                margin: 30px 0;
                padding: 20px;
                background: #f5f5f5;
                border-radius: 5px;
              }
              .qr-container img {
                width: 350px;
                height: 350px;
                border: 2px solid #667eea;
                border-radius: 3px;
              }
              .status {
                margin-top: 20px;
                padding: 10px;
                background: #e8f5e9;
                border-left: 4px solid #4caf50;
                border-radius: 3px;
              }
              .btn-refresh {
                margin-top: 20px;
                padding: 10px 20px;
                background: #667eea;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
              }
              .btn-refresh:hover {
                background: #5568d3;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📱 WhatsApp QR Code</h1>
              <p class="instruction">
                Abra WhatsApp → Configurações → Conectado a dispositivos → Escaneie este código com seu celular
              </p>
              <div class="qr-container">
                <img src="${qrImage}" alt="WhatsApp QR Code" />
              </div>
              <div class="status">
                ✅ QR Code gerado com sucesso. Aguardando scan...
              </div>
              <button class="btn-refresh" onclick="location.reload()">🔄 Atualizar</button>
            </div>
          </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);

    } catch (error) {
      this.logger.error(`Error generating QR code: ${error.message}`);
      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }

  /**
   * Lista todos os grupos em que o número está participando
   * GET /notifications/whatsapp/groups
   * Use para descobrir o ID correto (@g.us) do grupo para WHATSAPP_GROUP_ID no .env
   */
  @Get('groups')
  async listGroups() {
    try {
      const groups = await this.baileysProvider.listGroups();
      return { ok: true, data: groups };
    } catch (error) {
      this.logger.error(`Error listing groups: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Reenvia notificação WhatsApp de uma venda.
   * POST /notifications/whatsapp/resend/:orderId
   * Aceita externalId (ex: 2000015818700676) ou ObjectId do MongoDB.
   */
  @Post('resend/:orderId')
  async resendNotification(@Param('orderId') orderId: string) {
    return this.reconcilerService.resend(orderId);
  }

  /**
   * Endpoint para obter status da conexão WhatsApp
   * GET /notifications/whatsapp/status
   */
  @Get('status')
  async getStatus() {
    try {
      const status = await this.baileysProvider.getStatus();
      return {
        ok: true,
        data: status,
      };
    } catch (error) {
      this.logger.error(`Error getting status: ${error.message}`);
      return {
        ok: false,
        error: error.message,
      };
    }
  }
}
