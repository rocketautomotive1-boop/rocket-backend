// backend/src/general-product/general-product.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModule } from '../product/product.module';
import { PricingModule } from '../pricing/pricing.module';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductService } from './general-product.service';
import { GeneralDiscoveryService } from './services/general-discovery.service';
import { GeneralProductController } from './general-product.controller';

/**
 * Itens gerais (saúde, beleza, bebidas, alimentos). Persistem no ProductModel
 * unificado (banco único) com `domain:'general'` — sem conexão/coleção separada.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProductModel.name, schema: ProductSchema }]),
    // Discovery unificado: reusa o ProductDiscoveryService (status + intent único).
    ProductModule,
    // Preço efetivo (basePrice + overrides) vem do PricingModule, não de product.price.
    PricingModule,
  ],
  controllers: [GeneralProductController],
  providers: [GeneralProductRepository, GeneralProductService, GeneralDiscoveryService],
  exports: [GeneralProductService, GeneralProductRepository, GeneralDiscoveryService],
})
export class GeneralProductModule {}
