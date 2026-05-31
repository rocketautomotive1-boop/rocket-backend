// backend/scripts/migrate-marketplace-accounts.ts
/**
 * Cria uma MarketplaceAccount isDefault (domains: ['autoparts']) para cada marketplace
 * que tem tokens[]/credentials legados e ainda não tem conta default. Idempotente.
 *
 * Pré-requisito: MONGO_URI e MONGO_URI_GENERAL no .env (AppModule carrega ambas).
 * Run: npx ts-node -r tsconfig-paths/register scripts/migrate-marketplace-accounts.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { MarketplaceModel } from '../src/marketplace/schemas/marketplace.schema';
import { MarketplaceAccountModel } from '../src/marketplace/auth/schemas/marketplace-account.schema';

async function bootstrap() {
  const logger = new Logger('MigrateMarketplaceAccounts');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const marketplaceModel = app.get<Model<MarketplaceModel>>(getModelToken(MarketplaceModel.name));
    const accountModel = app.get<Model<MarketplaceAccountModel>>(getModelToken(MarketplaceAccountModel.name));

    const marketplaces = await marketplaceModel.find({}).lean().exec();
    let created = 0;
    let skipped = 0;

    for (const mp of marketplaces) {
      const mpId = (mp as any)._id;
      const existing = await accountModel.findOne({ marketplaceId: mpId, isDefault: true }).lean().exec();
      if (existing) { skipped++; continue; }

      const activeToken = (mp as any).tokens?.find((t: any) => t.isActive);
      await accountModel.create({
        marketplaceId: mpId,
        label: `${(mp as any).name} (Autopeças)`,
        isDefault: true,
        domains: ['autoparts'],
        credentials: (mp as any).credentials ?? {},
        token: activeToken
          ? {
              accessToken: activeToken.accessToken,
              refreshToken: activeToken.refreshToken,
              expiresAt: activeToken.expiresAt,
              tokenType: activeToken.tokenType,
              additionalData: activeToken.additionalData ?? {},
              isActive: true,
            }
          : undefined,
      });
      created++;
      logger.log(`Created default account for marketplace ${(mp as any).name} (${mpId})`);
    }

    logger.log(`Migration done. created=${created} skipped=${skipped} total=${marketplaces.length}`);
  } catch (err: any) {
    logger.error(`Migration failed: ${err?.message}`, err?.stack);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

bootstrap();
