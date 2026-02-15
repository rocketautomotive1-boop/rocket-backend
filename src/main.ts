import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// Carregar variáveis de ambiente do arquivo .env
config();

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Criar aplicação principal HTTP
  const app = await NestFactory.create(AppModule);

  // Aumentar limites de payload para JSON e URL-encoded
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ limit: '20mb', extended: true }));

  // Configurar validação global
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  // ...

  // Configurar Helmet (Headers de Segurança)
  app.use(helmet());

  // Configurar CORS
  app.enableCors({
    origin: '*', // TODO: Restrict to frontend domain in production
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Configurar Swagger
  const config = new DocumentBuilder()
    .setTitle('Marketplace Integration API')
    .setDescription('API para integração de produtos com diversos marketplaces')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  try {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: 'marketplace_queue',
        queueOptions: {
          durable: true,
        },
        noAck: false,
      },
    });

    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: 'product_queue',
        queueOptions: {
          durable: true,
        },
        noAck: false,
      },
    });

    await app.startAllMicroservices();
    console.log('✅ Microserviços RabbitMQ conectados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao conectar com RabbitMQ:', (error as any).message);
    console.log('⚠️  Aplicação continuará sem funcionalidades de fila');
  }

  // Iniciar servidor HTTP
  await app.listen(3000, '0.0.0.0');
  console.log(`🚀 Application is running on: ${await app.getUrl()}`);
}

bootstrap().catch(error => {
  console.error('❌ Erro fatal ao inicializar aplicação:', error);
  process.exit(1);
});