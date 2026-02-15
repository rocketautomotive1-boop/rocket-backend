import { Module, Global } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
    imports: [
        RabbitMQModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const uri = configService.get<string>('RABBITMQ_URI') || 'amqp://guest:guest@localhost:5672';
                return {
                    exchanges: [
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
                            type: 'topic', // Or direct, depending on if we want multiple listeners
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
export class RabbitMqModule { }
