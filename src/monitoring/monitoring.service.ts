import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../queue/schemas/queue-record.schema';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as prometheus from 'prom-client';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // Métricas Prometheus
  private queueSizeGauge: prometheus.Gauge;
  private queueProcessingTimeHistogram: prometheus.Histogram;
  private queueErrorCounter: prometheus.Counter;
  private marketplaceIntegrationCounter: prometheus.Counter;
  private productUpdateCounter: prometheus.Counter;

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    @Inject('PRODUCT_UPDATES_SERVICE')
    private productClient: ClientProxy,
    @InjectModel(QueueRecordModel.name)
    private queueRecordModel: Model<QueueRecordDocument>,
  ) {
    // Inicializar métricas Prometheus
    this.initPrometheusMetrics();
  }

  private initPrometheusMetrics() {
    // Registrar métricas apenas se não existirem
    if (prometheus.register.getSingleMetric('queue_size') === undefined) {
      this.queueSizeGauge = new prometheus.Gauge({
        name: 'queue_size',
        help: 'Número de jobs na fila',
        labelNames: ['queue_name'],
      });

      this.queueProcessingTimeHistogram = new prometheus.Histogram({
        name: 'queue_processing_time_seconds',
        help: 'Tempo de processamento dos jobs em segundos',
        labelNames: ['queue_name', 'job_type'],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
      });

      this.queueErrorCounter = new prometheus.Counter({
        name: 'queue_errors_total',
        help: 'Número total de erros nas filas',
        labelNames: ['queue_name', 'job_type', 'error_type'],
      });

      this.marketplaceIntegrationCounter = new prometheus.Counter({
        name: 'marketplace_integration_operations_total',
        help: 'Número total de operações de integração com marketplaces',
        labelNames: ['marketplace', 'operation_type', 'status'],
      });

      this.productUpdateCounter = new prometheus.Counter({
        name: 'product_updates_total',
        help: 'Número total de atualizações de produtos',
        labelNames: ['update_type', 'status'],
      });
    } else {
      this.queueSizeGauge = prometheus.register.getSingleMetric('queue_size') as prometheus.Gauge;
      this.queueProcessingTimeHistogram = prometheus.register.getSingleMetric('queue_processing_time_seconds') as prometheus.Histogram;
      this.queueErrorCounter = prometheus.register.getSingleMetric('queue_errors_total') as prometheus.Counter;
      this.marketplaceIntegrationCounter = prometheus.register.getSingleMetric('marketplace_integration_operations_total') as prometheus.Counter;
      this.productUpdateCounter = prometheus.register.getSingleMetric('product_updates_total') as prometheus.Counter;
    }
  }

  // Atualizar métricas a cada minuto
  @Cron(CronExpression.EVERY_MINUTE)
  async updateMetrics() {
    try {
      // Obter estatísticas das filas
      const marketplaceQueueCount = await this.getQueueCount('marketplace-integration');
      const productQueueCount = await this.getQueueCount('product-updates');

      this.queueSizeGauge.set({ queue_name: 'marketplace-integration' }, marketplaceQueueCount);
      this.queueSizeGauge.set({ queue_name: 'product-updates' }, productQueueCount);
    } catch (error) {
      this.logger.error(`Erro ao atualizar métricas: ${error.message}`, error.stack);
    }
  }

  // Método auxiliar para obter contagem de mensagens na fila
  private async getQueueCount(queueType: string): Promise<number> {
    try {
      const count = await this.queueRecordModel.countDocuments({
        status: 'pending',
        type: queueType
      });
      return count;
    } catch (error) {
      this.logger.error(`Erro ao obter contagem da fila ${queueType}: ${error.message}`);
      return 0;
    }
  }

  // Monitorar jobs concluídos e falhos
  async trackJobCompletion(queueName: string, jobType: string, processingTimeMs: number, status: string) {
    // Registrar tempo de processamento
    this.queueProcessingTimeHistogram.observe(
      { queue_name: queueName, job_type: jobType },
      processingTimeMs / 1000 // Converter para segundos
    );

    // Registrar operações por tipo
    if (queueName === 'marketplace-integration') {
      const [operation, marketplace] = jobType.split(':');
      this.marketplaceIntegrationCounter.inc({
        marketplace: marketplace || 'unknown',
        operation_type: operation || jobType,
        status,
      });
    } else if (queueName === 'product-updates') {
      this.productUpdateCounter.inc({
        update_type: jobType,
        status,
      });
    }

    // Registrar erros se houver
    if (status === 'failed') {
      this.queueErrorCounter.inc({
        queue_name: queueName,
        job_type: jobType,
        error_type: 'processing_error',
      });
    }

    this.logger.debug(`Job ${jobType} em ${queueName} concluído com status ${status} em ${processingTimeMs}ms`);
  }

  // Obter estatísticas das filas
  async getQueueStats() {
    const [
      marketplaceActive,
      marketplaceWaiting,
      marketplaceCompleted,
      marketplaceFailed,
      productActive,
      productWaiting,
      productCompleted,
      productFailed,
    ] = await Promise.all([
      this.queueRecordModel.countDocuments({ status: 'processing', type: 'marketplace-integration' }),
      this.queueRecordModel.countDocuments({ status: 'pending', type: 'marketplace-integration' }),
      this.queueRecordModel.countDocuments({ status: 'completed', type: 'marketplace-integration' }),
      this.queueRecordModel.countDocuments({ status: 'failed', type: 'marketplace-integration' }),
      this.queueRecordModel.countDocuments({ status: 'processing', type: 'product-updates' }),
      this.queueRecordModel.countDocuments({ status: 'pending', type: 'product-updates' }),
      this.queueRecordModel.countDocuments({ status: 'completed', type: 'product-updates' }),
      this.queueRecordModel.countDocuments({ status: 'failed', type: 'product-updates' }),
    ]);

    return {
      marketplace: {
        active: marketplaceActive,
        delayed: 0,
        waiting: marketplaceWaiting,
        completed: marketplaceCompleted,
        failed: marketplaceFailed,
        total: marketplaceActive + marketplaceWaiting,
      },
      product: {
        active: productActive,
        delayed: 0,
        waiting: productWaiting,
        completed: productCompleted,
        failed: productFailed,
        total: productActive + productWaiting,
      },
    };
  }

  // Obter estatísticas de processamento por marketplace
  async getMarketplaceStats(startDate: Date, endDate: Date) {
    const stats = await this.queueRecordModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            marketplaceId: "$marketplaceId",
            status: "$status"
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Organizar estatísticas por marketplace
    const marketplaceStats = {};

    stats.forEach(stat => {
      // Usar marketplaceId como nome por enquanto, pois perdemos a relação direta
      const marketplace = stat._id.marketplaceId ? `Marketplace_${stat._id.marketplaceId}` : 'unknown';
      const status = stat._id.status;
      const count = stat.count;

      if (!marketplaceStats[marketplace]) {
        marketplaceStats[marketplace] = {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          total: 0,
        };
      }

      if (status && marketplaceStats[marketplace][status] !== undefined) {
        marketplaceStats[marketplace][status] = count;
      }
      marketplaceStats[marketplace].total += count;
    });

    return marketplaceStats;
  }

  // Obter jobs com falha para retry
  async getFailedJobs(limit: number = 100) {
    return this.queueRecordModel.find({
      status: 'failed'
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .exec();
  }

  // Obter métricas Prometheus
  getMetrics() {
    return prometheus.register.metrics();
  }

  // Verificar saúde das filas
  async checkHealth() {
    try {
      const stats = await this.getQueueStats();

      const failedThreshold = 50;
      const marketplaceHealthy = stats.marketplace.failed < failedThreshold;
      const productHealthy = stats.product.failed < failedThreshold;

      const isProcessing = stats.marketplace.active > 0 || stats.product.active > 0;

      const stuckJobs = await this.checkStuckJobs();

      return {
        healthy: marketplaceHealthy && productHealthy && !stuckJobs.hasStuckJobs,
        marketplaceQueueHealthy: marketplaceHealthy,
        productQueueHealthy: productHealthy,
        isProcessing,
        stuckJobs: stuckJobs.hasStuckJobs,
        stuckJobsCount: stuckJobs.count,
        stats,
      };
    } catch (error) {
      this.logger.error(`Erro ao verificar saúde das filas: ${error.message}`, error.stack);
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  // Verificar jobs presos
  private async checkStuckJobs() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const stuckJobs = await this.queueRecordModel.countDocuments({
      status: 'processing',
      updatedAt: { $lt: oneHourAgo },
    });

    return {
      hasStuckJobs: stuckJobs > 0,
      count: stuckJobs,
    };
  }

  // Limpar filas (para manutenção)
  async cleanQueues(olderThan?: Date) {
    try {
      const dateFilter = olderThan || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 dias por padrão

      const result = await this.queueRecordModel.deleteMany({
        status: 'completed',
        updatedAt: { $lt: dateFilter },
      });

      this.logger.log(`Limpeza de filas concluída: ${result.deletedCount} registros removidos`);

      return {
        success: true,
        removedCount: result.deletedCount,
      };
    } catch (error) {
      this.logger.error(`Erro ao limpar filas: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Obter logs do sistema
  async getLogs(limit: number = 100) {
    // Implementação simplificada
    return {
      logs: [
        { timestamp: new Date(), level: 'info', message: 'Sistema iniciado' },
        { timestamp: new Date(), level: 'info', message: 'Conexão com banco de dados estabelecida' },
        { timestamp: new Date(), level: 'info', message: 'Filas inicializadas' },
      ],
      count: 3,
    };
  }

  // Método para obter status das filas (alias para getQueueStats para compatibilidade)
  async getQueueStatus() {
    return this.getQueueStats();
  }
}
