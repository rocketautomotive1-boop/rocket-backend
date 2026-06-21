import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MercadoPagoBalanceService } from './mercado-pago-balance.service';

/**
 * Mantém o saldo disponível do MP em cache (release_report é assíncrono).
 * Roda a cada 30min e uma vez logo após o boot.
 */
@Injectable()
export class MercadoPagoBalanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(MercadoPagoBalanceScheduler.name);
  private running = false;

  constructor(private readonly balance: MercadoPagoBalanceService) {}

  onModuleInit(): void {
    // Primeiro refresh logo após o boot (sem travar a inicialização).
    setTimeout(() => void this.refresh(), 150_000);
  }

  @Cron(CronExpression.EVERY_11_HOURS)
  async scheduled(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.balance.refreshAvailable();
    } catch (err) {
      this.logger.warn(`Falha ao atualizar saldo disponível do MP: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
