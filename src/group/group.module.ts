import { Global, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupModel, GroupSchema } from './schemas/group.schema';
import { GroupService } from './services/group.service';
import { GroupController } from './group.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Provedor `@Global` do GroupService. Folha (só depende do model Mongoose),
 * mesmo padrão do MarketplaceConfigCacheModule — evita forwardRef entre
 * quem resolve a conta de publicação por grupo (product/marketplace) e quem
 * gerencia grupos.
 *
 * GroupController expõe CRUD mínimo (leitura + edição de mapeamento) para a
 * tela de gestão de lojas — precisa de JwtAuthGuard/RolesGuard, exportados
 * por AuthModule; forwardRef porque GroupModule é @Global (pode carregar
 * antes de AuthModule terminar de resolver). Consome
 * MarketplaceConfigCacheService via DI global (MarketplaceConfigCacheModule,
 * registrado no AppModule) — não precisa importar aqui.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: GroupModel.name, schema: GroupSchema }]),
    forwardRef(() => AuthModule),
  ],
  controllers: [GroupController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupModule {}
