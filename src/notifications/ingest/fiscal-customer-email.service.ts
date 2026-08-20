import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../email.service';
import {
    FISCAL_EVENTS,
    FiscalDanfeReadyEvent,
    FiscalNfeAuthorizedEvent,
} from '../../fiscal/events/fiscal.events';

/**
 * E-mail transacional com a NFe ao cliente. Espera DANFE_READY (XML + PDF juntos —
 * o cliente prefere o PDF, mesmo o XML sendo o documento fiscal oficial). Se a
 * geração do DANFE falhar (DANFE_FAILED), envia mesmo assim só com o XML — o
 * cliente nunca deve ficar sem nada por causa de uma falha no PDF.
 */
@Injectable()
export class FiscalCustomerEmailService {
    private readonly logger = new Logger(FiscalCustomerEmailService.name);

    constructor(private readonly emailService: EmailService) { }

    @OnEvent(FISCAL_EVENTS.DANFE_READY, { async: true })
    async onDanfeReady(event: FiscalDanfeReadyEvent): Promise<void> {
        if (!event.customerEmail) {
            this.logger.debug(`NFe ${event.nfeId} sem e-mail de cliente — pulando envio.`);
            return;
        }
        try {
            const danfePdf = await this.downloadDanfe(event.danfeUrl);
            await this.emailService.sendEmail(
                event.customerEmail,
                `Nota Fiscal Eletrônica — Série ${event.series} Nº ${event.number}`,
                this.buildEmailHtml(event.customerName, event.series, event.number, event.accessKey),
                [
                    { filename: `NFe-${event.accessKey}.xml`, content: event.xml, contentType: 'application/xml' },
                    ...(danfePdf ? [{ filename: `DANFE-${event.accessKey}.pdf`, content: danfePdf, contentType: 'application/pdf' }] : []),
                ],
            );
        } catch (err) {
            this.logger.error(`Falha ao enviar e-mail de NFe ${event.nfeId}: ${err.message}`);
        }
    }

    @OnEvent(FISCAL_EVENTS.DANFE_FAILED, { async: true })
    async onDanfeFailed(event: FiscalNfeAuthorizedEvent): Promise<void> {
        if (!event.customerEmail) return;
        try {
            await this.emailService.sendEmail(
                event.customerEmail,
                `Nota Fiscal Eletrônica — Série ${event.series} Nº ${event.number}`,
                this.buildEmailHtml(event.customerName, event.series, event.number, event.accessKey),
                [{ filename: `NFe-${event.accessKey}.xml`, content: event.xml, contentType: 'application/xml' }],
            );
        } catch (err) {
            this.logger.error(`Falha ao enviar e-mail (fallback sem DANFE) de NFe ${event.nfeId}: ${err.message}`);
        }
    }

    private async downloadDanfe(url: string): Promise<Buffer | null> {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            return Buffer.from(await res.arrayBuffer());
        } catch (err) {
            this.logger.warn(`Falha ao baixar DANFE de ${url}: ${(err as Error).message}`);
            return null;
        }
    }

    private buildEmailHtml(customerName: string | undefined, series: number, number: number, accessKey: string): string {
        const greeting = customerName ? `Olá, ${customerName}!` : 'Olá!';
        return `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #0F172A;">
  <p>${greeting}</p>
  <p>Sua Nota Fiscal Eletrônica foi emitida com sucesso.</p>
  <p><strong>Série:</strong> ${series} &nbsp; <strong>Número:</strong> ${number}</p>
  <p><strong>Chave de acesso:</strong> <span style="font-family: monospace;">${accessKey}</span></p>
  <p>Os arquivos da nota (XML e PDF) estão anexados a este e-mail.</p>
</div>`;
    }
}
