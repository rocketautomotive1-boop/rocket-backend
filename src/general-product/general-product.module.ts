// backend/src/general-product/general-product.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GENERAL_CONNECTION } from '../database/connections';
import { GeneralProductModel, GeneralProductSchema } from './schemas/general-product.schema';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductService } from './general-product.service';

/**
 * Domínio de itens gerais (saúde, beleza, bebidas, alimentos).
 * Registra o model na conexão `general` (Mongo B) — isolado de autopeças.
 */
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: GeneralProductModel.name, schema: GeneralProductSchema }],
      GENERAL_CONNECTION,
    ),
  ],
  providers: [GeneralProductRepository, GeneralProductService],
  exports: [GeneralProductService, GeneralProductRepository],
})
export class GeneralProductModule {}
