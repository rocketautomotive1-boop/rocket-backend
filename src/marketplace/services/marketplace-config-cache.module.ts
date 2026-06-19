import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModel, MarketplaceSchema } from '../schemas/marketplace.schema';
import { MarketplaceConfigCacheService } from './marketplace-config-cache.service';

/**
 * Provedor `@Global` do cache de config de marketplace. É folha (só depende do
 * model Mongoose), então Registry/Credentials/Auth podem consumi-lo sem criar
 * dependência circular entre módulos — sem `forwardRef`.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketplaceModel.name, schema: MarketplaceSchema },
    ]),
  ],
  providers: [MarketplaceConfigCacheService],
  exports: [MarketplaceConfigCacheService],
})
export class MarketplaceConfigCacheModule {}
