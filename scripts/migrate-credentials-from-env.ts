/**
 * One-shot: lê variáveis legadas do .env e popula `marketplace.credentials` criptografado.
 *
 * Rodar uma vez após o deploy do refactor. Idempotente — não sobrescreve credenciais já presentes
 * no DB a menos que --force seja passado.
 *
 * Uso:
 *   ts-node scripts/migrate-credentials-from-env.ts
 *   ts-node scripts/migrate-credentials-from-env.ts --force
 *   ts-node scripts/migrate-credentials-from-env.ts --dry-run
 */
import { NestFactory } from '@nestjs/core';
import { Module, Logger } from '@nestjs/common';
import { MongooseModule, InjectModel } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceSchema, MarketplaceDocument } from '../src/marketplace/schemas/marketplace.schema';
import { encrypt } from '../src/marketplace/auth/services/credentials-crypto.helper';

interface CredMap {
  envKey: string;
  credKey: string;
}

const MIGRATION_MAP: Record<string, CredMap[]> = {
  shopee: [
    { envKey: 'SHOPEE_PARTNER_ID', credKey: 'partnerId' },
    { envKey: 'SHOPEE_PARTNER_KEY', credKey: 'partnerKey' },
    { envKey: 'SHOPEE_SHOP_ID', credKey: 'shopId' },
  ],
  mercadolivre: [
    { envKey: 'MERCADO_LIVRE_APP_ID', credKey: 'clientId' },
    { envKey: 'MERCADO_LIVRE_CLIENT_SECRET', credKey: 'clientSecret' },
    { envKey: 'MERCADO_LIVRE_WEBHOOK_SECRET', credKey: 'webhookSecret' },
  ],
  amazon: [
    { envKey: 'AMAZON_APP_ID', credKey: 'appId' },
    { envKey: 'AMAZON_CLIENT_SECRET', credKey: 'clientSecret' },
    { envKey: 'AMAZON_AWS_ACCESS_KEY', credKey: 'awsAccessKey' },
    { envKey: 'AMAZON_AWS_SECRET_KEY', credKey: 'awsSecretKey' },
    { envKey: 'AMAZON_SP_APP_ID', credKey: 'spAppId' },
  ],
  magalu: [
    { envKey: 'MAGALU_CLIENT_ID', credKey: 'clientId' },
    { envKey: 'MAGALU_CLIENT_SECRET', credKey: 'clientSecret' },
    { envKey: 'MAGALU_REDIRECT_URI', credKey: 'redirectUri' },
    { envKey: 'MAGALU_WEBHOOK_SECRET', credKey: 'webhookSecret' },
  ],
  olx: [
    { envKey: 'OLX_CLIENT_ID', credKey: 'clientId' },
    { envKey: 'OLX_REDIRECT_URI', credKey: 'redirectUri' },
  ],
  tiktokshop: [
    { envKey: 'TIKTOK_SHOP_APP_KEY', credKey: 'appKey' },
    { envKey: 'TIKTOK_SHOP_APP_SECRET', credKey: 'appSecret' },
  ],
  yampi: [{ envKey: 'YAMPI_WEBHOOK_SECRET', credKey: 'webhookSecret' }],
  viavarejo: [{ envKey: 'VIAVAREJO_WEBHOOK_SECRET', credKey: 'webhookSecret' }],
  b2w: [{ envKey: 'B2W_WEBHOOK_SECRET', credKey: 'webhookSecret' }],
  aliexpress: [{ envKey: 'ALIEXPRESS_WEBHOOK_SECRET', credKey: 'webhookSecret' }],
};

@Injectable()
class MigrationRunner {
  private readonly logger = new Logger('CredentialsMigration');

  constructor(
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  async run(opts: { force: boolean; dryRun: boolean }) {
    // OLX special case: secret depends on clientId (OLX_CLIENT_SECRET_${clientId})
    const olxClientId = process.env.OLX_CLIENT_ID;
    if (olxClientId) {
      MIGRATION_MAP.olx.push({
        envKey: `OLX_CLIENT_SECRET_${olxClientId}`,
        credKey: 'clientSecret',
      });
    }

    for (const [tag, mappings] of Object.entries(MIGRATION_MAP)) {
      await this.migrateOne(tag, mappings, opts);
    }
  }

  private async migrateOne(tag: string, mappings: CredMap[], opts: { force: boolean; dryRun: boolean }) {
    const marketplace = await this.marketplaceModel
      .findOne({ $or: [{ tag }, { tag: tag.replace('mercadolivre', 'mercado-livre') }] })
      .exec();

    if (!marketplace) {
      this.logger.warn(`Marketplace tag='${tag}' não encontrado no DB — pulando.`);
      return;
    }

    const current = (marketplace.credentials as Record<string, string>) || {};
    const updates: Record<string, string> = {};
    const skipped: string[] = [];

    // Fallback secundário: tokens[].additionalData (OAuth flows que salvavam clientSecret/etc lá)
    const activeToken = (marketplace.tokens || []).find((t: any) => t.isActive);
    const tokenExtras = (activeToken?.additionalData || {}) as Record<string, any>;

    for (const { envKey, credKey } of mappings) {
      const envValue = process.env[envKey];
      const tokenValue = tokenExtras[credKey] != null ? String(tokenExtras[credKey]) : undefined;
      const value = envValue || tokenValue;
      const source = envValue ? 'env' : tokenValue ? 'token.additionalData' : null;

      if (!value) {
        skipped.push(`${credKey} (sem fonte: ${envKey} vazio + token sem ${credKey})`);
        continue;
      }
      if (current[credKey] && !opts.force) {
        skipped.push(`${credKey} (já existe no DB)`);
        continue;
      }
      updates[`credentials.${credKey}`] = encrypt(value);
      this.logger.log(`[${tag}] ${credKey} ← ${source}`);
    }

    if (Object.keys(updates).length === 0) {
      this.logger.log(`[${tag}] Nada a migrar. Skipped: ${skipped.join(', ') || 'nenhum'}`);
      return;
    }

    if (opts.dryRun) {
      this.logger.log(
        `[${tag}] DRY RUN — atualizaria: ${Object.keys(updates)
          .map((k) => k.replace('credentials.', ''))
          .join(', ')}`,
      );
      return;
    }

    await this.marketplaceModel.updateOne({ _id: marketplace._id }, { $set: updates });
    this.logger.log(
      `[${tag}] ✅ Migrado: ${Object.keys(updates)
        .map((k) => k.replace('credentials.', ''))
        .join(', ')}` + (skipped.length ? ` | Skipped: ${skipped.join(', ')}` : ''),
    );
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGO_URI || ''),
    MongooseModule.forFeature([{ name: MarketplaceModel.name, schema: MarketplaceSchema }]),
  ],
  providers: [MigrationRunner],
})
class MigrationModule {}

async function bootstrap() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  const app = await NestFactory.createApplicationContext(MigrationModule, { logger: ['log', 'warn', 'error'] });
  const runner = app.get(MigrationRunner);

  console.log(`\n=== Credentials migration ===`);
  console.log(`force=${force}  dry-run=${dryRun}\n`);

  try {
    await runner.run({ force, dryRun });
    console.log('\n✅ Migração concluída.\n');
  } catch (err: any) {
    console.error('❌ Falha na migração:', err.message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

bootstrap();
