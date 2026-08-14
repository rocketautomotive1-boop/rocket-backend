import { Global, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreModel, StoreSchema } from './schemas/store.schema';
import { StoreService } from './services/store.service';
import { StoreController } from './store.controller';
import { STORE_PORT } from './ports/store.port';
import { AuthModule } from '../auth/auth.module';

/**
 * Provedor `@Global` do StoreService/STORE_PORT. Folha (só depende do model
 * Mongoose), mesmo padrão do MarketplaceConfigCacheModule — evita
 * forwardRef entre quem resolve a conta de publicação por loja
 * (product/listing/marketplace/store-listing) e quem gerencia lojas.
 *
 * StoreController expõe CRUD para o painel admin/ — precisa de
 * JwtAuthGuard/RolesGuard, exportados por AuthModule; forwardRef porque
 * StoreModule é @Global (pode carregar antes de AuthModule terminar de
 * resolver). Consome MarketplaceConfigCacheService via DI global
 * (MarketplaceConfigCacheModule, registrado no AppModule) — não precisa
 * importar aqui.
 *
 * Consumidores externos (ex: store-listing/) devem injetar STORE_PORT, não
 * StoreService diretamente — mantém store/ substituível sem tocar em quem
 * consome.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: StoreModel.name, schema: StoreSchema }]),
    forwardRef(() => AuthModule),
  ],
  controllers: [StoreController],
  providers: [StoreService, { provide: STORE_PORT, useExisting: StoreService }],
  exports: [StoreService, STORE_PORT],
})
export class StoreModule {}
