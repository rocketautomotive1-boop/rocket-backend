import { Global, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreModel, StoreSchema } from './schemas/store.schema';
import { StoreService } from './services/store.service';
import { StoreController } from './store.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Provedor `@Global` do StoreService. Folha (só depende do model Mongoose),
 * mesmo padrão do MarketplaceConfigCacheModule — evita forwardRef entre quem
 * resolve a conta de publicação por loja (product/listing/marketplace) e
 * quem gerencia lojas.
 *
 * StoreController expõe CRUD para o painel admin/ — precisa de
 * JwtAuthGuard/RolesGuard, exportados por AuthModule; forwardRef porque
 * StoreModule é @Global (pode carregar antes de AuthModule terminar de
 * resolver). Consome MarketplaceConfigCacheService via DI global
 * (MarketplaceConfigCacheModule, registrado no AppModule) — não precisa
 * importar aqui.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: StoreModel.name, schema: StoreSchema }]),
    forwardRef(() => AuthModule),
  ],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
