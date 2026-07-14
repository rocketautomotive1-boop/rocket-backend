import { Injectable, Inject, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { OtpModel, OtpDocument, OtpChannel, OtpPurpose } from './schemas/otp.schema';
import { EmailService } from '../notifications/email.service';
import { WHATSAPP_PORT, WhatsAppPort } from '../whatsapp/whatsapp.port';
import { ZenviaSmsClient } from './zenvia-sms.client';

const CODE_TTL_MINUTES = 8;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MINUTES = 15;
const MAX_VALIDATION_ATTEMPTS = 5;

@Injectable()
export class OtpService {
    private readonly logger = new Logger(OtpService.name);

    constructor(
        @InjectModel(OtpModel.name) private readonly otpModel: Model<OtpDocument>,
        private readonly emailService: EmailService,
        @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
        private readonly zenviaSms: ZenviaSmsClient,
    ) { }

    async send(destination: string, channel: OtpChannel, purpose: OtpPurpose): Promise<void> {
        const windowStart = new Date(Date.now() - SEND_WINDOW_MINUTES * 60_000);
        const recentSends = await this.otpModel.countDocuments({
            destination,
            channel,
            createdAt: { $gte: windowStart },
        });
        if (recentSends >= MAX_SENDS_PER_WINDOW) {
            throw new HttpException(
                'Muitos códigos solicitados. Aguarde alguns minutos antes de tentar novamente.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const code = this.generateCode();
        const codeHash = this.hashCode(code);
        const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

        await this.otpModel.create({ destination, channel, purpose, codeHash, expiresAt });

        await this.deliver(destination, channel, code);
    }

    async verify(destination: string, channel: OtpChannel, purpose: OtpPurpose, code: string): Promise<boolean> {
        const otp = await this.otpModel
            .findOne({ destination, channel, purpose, consumed: false })
            .sort({ createdAt: -1 })
            .exec();

        if (!otp) return false;
        if (otp.expiresAt < new Date()) return false;
        if (otp.attempts >= MAX_VALIDATION_ATTEMPTS) return false;

        const isValid = otp.codeHash === this.hashCode(code);

        if (!isValid) {
            otp.attempts += 1;
            await otp.save();
            return false;
        }

        otp.consumed = true;
        await otp.save();
        return true;
    }

    private async deliver(destination: string, channel: OtpChannel, code: string): Promise<void> {
        const text = `Seu código Rocket Automotive é ${code}. Válido por ${CODE_TTL_MINUTES} minutos.`;

        if (channel === 'email') {
            await this.emailService.sendEmail(
                destination,
                'Seu código de acesso Rocket Automotive',
                `<p>Seu código de acesso é <strong>${code}</strong>.</p><p>Válido por ${CODE_TTL_MINUTES} minutos.</p>`,
            );
            return;
        }

        if (channel === 'whatsapp') {
            try {
                await this.whatsapp.sendNow(destination, text);
                return;
            } catch (error: any) {
                this.logger.warn(`WhatsApp indisponível para OTP (${destination}), usando SMS como fallback: ${error.message}`);
                const sent = await this.zenviaSms.sendSms(destination, text);
                if (!sent) throw new BadRequestException('Não foi possível enviar o código. Tente novamente mais tarde.');
                return;
            }
        }

        if (channel === 'sms') {
            const sent = await this.zenviaSms.sendSms(destination, text);
            if (!sent) throw new BadRequestException('Não foi possível enviar o código. Tente novamente mais tarde.');
            return;
        }
    }

    private generateCode(): string {
        return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    }

    private hashCode(code: string): string {
        return crypto.createHash('sha256').update(code).digest('hex');
    }
}
