import { Module, Global, OnModuleInit, Logger } from '@nestjs/common';
import { RabbitMQModule, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
    imports: [
        RabbitMQModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const uri = configService.get<string>('RABBITMQ_URL') || 'amqp://guest:guest@localhost:5672';
                return {
                    exchanges: [
                        {
                            name: 'rocket.orders',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.inventory',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.marketplace.sync',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.marketplace.results',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.notifications',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.notifications.dlq',
                            type: 'topic',
                        },
                        {
                            name: 'rocket.orchestrator',
                            type: 'topic',
                            options: { durable: true },
                        },
                        {
                            // Declarado pelo scraper Python como DIRECT durable — precisa casar.
                            name: 'rocket.scraper',
                            type: 'direct',
                            options: { durable: true },
                        },
                    ],
                    uri: uri,
                    connectionInitOptions: { wait: false },
                    enableControllerDiscovery: true, // Enables @RabbitSubscribe
                };
            },
        }),
    ],
    exports: [RabbitMQModule],
})
export class RabbitMqModule implements OnModuleInit {
    private readonly logger = new Logger('RabbitMqModule');

    constructor(private readonly amqpConnection: AmqpConnection) { }

    onModuleInit() {
        this.amqpConnection.managedConnection.on('connect', () => {
            this.logger.log('✅ Conectado ao RabbitMQ com sucesso.');
        });

        this.amqpConnection.managedConnection.on('disconnect', (err) => {
            this.logger.warn(`❌ Conexão com RabbitMQ perdida. Tentando reconectar... Motivo: ${err.err?.message || 'Erro desconhecido'}`);
        });
    }
}
