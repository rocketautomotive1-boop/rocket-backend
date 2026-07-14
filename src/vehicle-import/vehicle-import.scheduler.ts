import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VehicleImportService } from './services/vehicle-import.service';
import { VehicleImportStateModel } from './schemas/vehicle-import-state.schema';
import { MercadoLivreCompatibilityAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';

const CATALOG_DOMAIN_ID = 'MLB-CARS_AND_VANS';

@Injectable()
export class VehicleImportScheduler {
  private readonly logger = new Logger(VehicleImportScheduler.name);

  constructor(
    private readonly vehicleImportService: VehicleImportService,
    private readonly mlCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    @InjectModel(VehicleImportStateModel.name)
    private readonly stateModel: Model<VehicleImportStateModel>,
  ) {}

  /**
   * Gate: só roda a varredura completa se `products_last_updated` do domínio mudou desde a
   * última execução. Isso não reduz o ESCOPO da varredura (a API não dá granularidade por
   * marca/produto) — só evita rodar horas de importação numa semana em que nada mudou no
   * catálogo inteiro. Se a checagem falhar (erro de rede), roda mesmo assim — não bloqueia a
   * importação por causa de uma otimização secundária.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyImport() {
    const shouldRun = await this.shouldRun();
    if (!shouldRun) {
      this.logger.log('Catálogo ML sem mudanças desde a última importação — pulando esta semana.');
      return;
    }

    this.logger.log('Iniciando importação semanal da taxonomia de veículos do Mercado Livre');
    try {
      const result = await this.vehicleImportService.importFromMercadoLivre();
      this.logger.log(`Importação semanal concluída: ${JSON.stringify(result)}`);
      await this.saveState();
    } catch (error: any) {
      this.logger.error(`Erro na importação semanal de veículos: ${error?.message}`);
    }
  }

  private async shouldRun(): Promise<boolean> {
    try {
      const domain = await this.mlCompatibilityAdapter.getCatalogDomain(CATALOG_DOMAIN_ID);
      const current = domain?.products_last_updated as string | undefined;
      if (!current) return true;

      const state = await this.stateModel.findById('singleton').lean().exec();
      return current !== state?.lastProductsUpdatedAt;
    } catch (err: any) {
      this.logger.warn(`Falha ao checar products_last_updated, rodando mesmo assim: ${err?.message}`);
      return true;
    }
  }

  private async saveState(): Promise<void> {
    try {
      const domain = await this.mlCompatibilityAdapter.getCatalogDomain(CATALOG_DOMAIN_ID);
      await this.stateModel.updateOne(
        { _id: 'singleton' },
        { $set: { lastProductsUpdatedAt: domain?.products_last_updated, lastRunAt: new Date() } },
        { upsert: true },
      ).exec();
    } catch (err: any) {
      this.logger.warn(`Falha ao salvar estado da importação: ${err?.message}`);
    }
  }
}
