import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupModel, GroupSchema } from './schemas/group.schema';
import { GroupService } from './services/group.service';

/**
 * Provedor `@Global` do GroupService. Folha (só depende do model Mongoose),
 * mesmo padrão do MarketplaceConfigCacheModule — evita forwardRef entre
 * quem resolve a conta de publicação por grupo (product/marketplace) e quem
 * gerencia grupos.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: GroupModel.name, schema: GroupSchema }]),
  ],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupModule {}
