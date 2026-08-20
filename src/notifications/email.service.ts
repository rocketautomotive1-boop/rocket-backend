import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(EmailService.name);

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('SMTP_HOST'),
            port: this.configService.get<number>('SMTP_PORT'),
            secure: this.configService.get<boolean>('SMTP_SECURE', false),
            auth: {
                user: this.configService.get<string>('SMTP_USER'),
                pass: this.configService.get<string>('SMTP_PASS'),
            },
        });
    }

    async sendEmail(
        to: string,
        subject: string,
        html: string,
        attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>,
    ) {
        try {
            const info = await this.transporter.sendMail({
                from: this.configService.get<string>('SMTP_FROM', '"Rocket Parts" <noreply@rocketparts.com.br>'),
                to,
                subject,
                html,
                attachments,
            });
            this.logger.log(`Email sent: ${info.messageId}`);
            return true;
        } catch (error) {
            this.logger.error(`Error sending email to ${to}: ${error.message}`);
            return false;
        }
    }
}
