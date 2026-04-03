import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MicroserviceHealthIndicator,
  MongooseHealthIndicator,
  HttpHealthIndicator,
  //ElasticsearchHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { S3HealthIndicator } from './indicators/s3.health';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private microservice: MicroserviceHealthIndicator,
    private mongoose: MongooseHealthIndicator,
    private http: HttpHealthIndicator,
  // private elasticsearch: ElasticsearchHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private s3: S3HealthIndicator,
    private configService: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // 1. Banco de Dados (MongoDB)
      () => this.mongoose.pingCheck('mongodb'),

      // 2. Broker de Mensagens (RabbitMQ)
      () =>
        this.microservice.pingCheck('rabbitmq', {
          transport: Transport.RMQ,
          options: {
            urls: [this.configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672')],
          },
        }),

      // 3. Mecanismo de Busca (Elasticsearch)
      //() => this.elasticsearch.pingCheck('elasticsearch'),

      // 4. Armazenamento de Arquivos (AWS S3)
      () => this.s3.isHealthy('aws-s3'),

      // 5. APIs Externas (Marketplaces)
      () => this.http.pingCheck('mercado-livre', 'https://api.mercadolibre.com'),
      () => this.http.pingCheck('magalu', 'https://api.magalu.com'),
      // OLX pode retornar 403 em ping simples, mas vamos testar a conectividade base
      () => this.http.pingCheck('olx-auth', 'https://auth.olx.com.br'),

      // 6. Recursos do Sistema
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300MB
      () => this.disk.checkStorage('disk', { thresholdPercent: 0.9, path: '/' }), // 90%
    ]);
  }
}
