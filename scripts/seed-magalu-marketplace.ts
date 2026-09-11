/**
 * Insere (idempotente, via upsert) o documento de config do marketplace
 * Magalu em `marketplaces`. Não há seed automático para novos marketplaces
 * neste repo (confirmado — nenhum outro marketplace tem um) — este é o
 * primeiro, criado como um script one-off standalone.
 *
 * Uso:
 *   cd backend && npx ts-node -r tsconfig-paths/register scripts/seed-magalu-marketplace.ts
 *
 * Credenciais (client_id/client_secret do client IDM "maxeshop") NÃO são
 * definidas aqui — devem ser configuradas depois via MarketplaceCredentialsService
 * (endpoint /marketplaces/:tag/credentials ou tela do admin/), cifradas no
 * Mongo. Nunca hardcoded neste script nem em .env versionado.
 */
import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceSchema } from '../src/marketplace/schemas/marketplace.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    MongooseModule.forFeature([{ name: MarketplaceModel.name, schema: MarketplaceSchema }]),
  ],
})
class SeedMagaluModule {}

async function bootstrap() {
  const logger = new Logger('SeedMagaluMarketplace');
  const app = await NestFactory.createApplicationContext(SeedMagaluModule, { logger: ['error', 'warn', 'log'] });

  try {
    const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));

    const result = await marketplaceModel.updateOne(
      { tag: 'magalu' },
      {
        $setOnInsert: {
          name: 'Magalu',
          tag: 'magalu',
          tokenStrategy: 'oauth2',
          enabled: true,
          accounts: [],
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      logger.log('Marketplace "Magalu" (tag=magalu) criado.');
    } else {
      logger.log('Marketplace "Magalu" (tag=magalu) já existia — nenhuma alteração.');
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao rodar seed do Magalu:', err);
  process.exit(1);
});
