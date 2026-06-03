// backend/src/general-product/general-product.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductService } from './general-product.service';
import { GeneralDiscoveryService } from './services/general-discovery.service';
import { GeneralDiscoveryResponseConsumer } from './consumers/general-discovery-response.consumer';
import { GeneralProductController } from './general-product.controller';

/**
 * Itens gerais (saúde, beleza, bebidas, alimentos). Persistem no ProductModel
 * unificado (banco único) com `domain:'general'` — sem conexão/coleção separada.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProductModel.name, schema: ProductSchema }]),
  ],
  controllers: [GeneralProductController],
  providers: [GeneralProductRepository, GeneralProductService, GeneralDiscoveryService, GeneralDiscoveryResponseConsumer],
  exports: [GeneralProductService, GeneralProductRepository, GeneralDiscoveryService],
})
export class GeneralProductModule {}
