// backend/src/general-product/general-product.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GENERAL_CONNECTION } from '../database/connections';
import { GeneralProductModel, GeneralProductSchema } from './schemas/general-product.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../product/schemas/stock-movement.schema';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductService } from './general-product.service';
import { GeneralProductProjectionService } from './projection/general-product-projection.service';
import { GeneralDiscoveryService } from './services/general-discovery.service';
import { GeneralDiscoveryResponseConsumer } from './consumers/general-discovery-response.consumer';
import { GeneralProductController } from './general-product.controller';

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
    // Projeção escreve na conexão default (Mongo A) — mesma que o orchestrator lê.
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: StockMovementModel.name, schema: StockMovementSchema },
    ]),
  ],
  controllers: [GeneralProductController],
  providers: [GeneralProductRepository, GeneralProductService, GeneralProductProjectionService, GeneralDiscoveryService, GeneralDiscoveryResponseConsumer],
  exports: [GeneralProductService, GeneralProductRepository, GeneralProductProjectionService, GeneralDiscoveryService],
})
export class GeneralProductModule {}
