import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Cliente mínimo da API REST da Zenvia (SMS) — fallback quando o WhatsApp não
 * está conectado. Sem SDK dedicado: só 1 endpoint usado, não justifica dependência.
 */
@Injectable()
export class ZenviaSmsClient {
    private readonly logger = new Logger(ZenviaSmsClient.name);

    constructor(private readonly configService: ConfigService) { }

    async sendSms(phone: string, text: string): Promise<boolean> {
        const apiToken = this.configService.get<string>('ZENVIA_API_TOKEN');
        const from = this.configService.get<string>('ZENVIA_SMS_FROM', 'Rocket');

        if (!apiToken) {
            this.logger.warn('ZENVIA_API_TOKEN não configurado — SMS não enviado.');
            return false;
        }

        try {
            await axios.post(
                'https://api.zenvia.com/v2/channels/sms/messages',
                {
                    from,
                    to: phone,
                    contents: [{ type: 'text', text }],
                },
                { headers: { 'X-API-TOKEN': apiToken, 'Content-Type': 'application/json' } },
            );
            return true;
        } catch (error: any) {
            this.logger.error(`Erro ao enviar SMS via Zenvia para ${phone}: ${error.message}`);
            return false;
        }
    }
}
