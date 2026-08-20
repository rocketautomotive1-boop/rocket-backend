import { Test } from '@nestjs/testing';
import { FiscalCustomerEmailService } from './fiscal-customer-email.service';
import { EmailService } from '../email.service';
import { FiscalDanfeReadyEvent, FiscalNfeAuthorizedEvent } from '../../fiscal/events/fiscal.events';

describe('FiscalCustomerEmailService', () => {
  let service: FiscalCustomerEmailService;
  let emailService: { sendEmail: jest.Mock };
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    emailService = { sendEmail: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalCustomerEmailService,
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(FiscalCustomerEmailService);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('onDanfeReady', () => {
    const event = new FiscalDanfeReadyEvent(
      'nfe-1', 'order-1', 'CHAVE123', 1, 42, '<xml/>',
      'https://s3.example.com/danfe.pdf', 'cliente@example.com', 'Cliente Teste',
    );

    it('envia e-mail com XML + PDF anexados quando o download do DANFE funciona', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('fake-pdf').buffer,
      }) as any;

      await service.onDanfeReady(event);

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, , attachments] = emailService.sendEmail.mock.calls[0];
      expect(to).toBe('cliente@example.com');
      expect(subject).toContain('Nota Fiscal');
      expect(attachments).toHaveLength(2);
      expect(attachments[0].filename).toBe('NFe-CHAVE123.xml');
      expect(attachments[1].filename).toBe('DANFE-CHAVE123.pdf');
    });

    it('envia só o XML quando o download do PDF falha', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;

      await service.onDanfeReady(event);

      const [, , , attachments] = emailService.sendEmail.mock.calls[0];
      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('NFe-CHAVE123.xml');
    });

    it('não envia e-mail quando não há customerEmail', async () => {
      const eventNoEmail = new FiscalDanfeReadyEvent(
        'nfe-1', 'order-1', 'CHAVE123', 1, 42, '<xml/>', 'https://s3.example.com/danfe.pdf',
      );

      await service.onDanfeReady(eventNoEmail);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('onDanfeFailed', () => {
    it('envia e-mail só com XML (fallback) quando a geração do DANFE falhou', async () => {
      const event = new FiscalNfeAuthorizedEvent(
        'nfe-1', 'order-1', 'store-1', 'CHAVE123', 1, 42, '<xml/>', 'cliente@example.com', 'Cliente Teste',
      );

      await service.onDanfeFailed(event);

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      const [, , , attachments] = emailService.sendEmail.mock.calls[0];
      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('NFe-CHAVE123.xml');
    });
  });
});
