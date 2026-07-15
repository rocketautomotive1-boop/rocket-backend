import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { VehicleCompatibilityModel, VehicleCompatibilitySchema } from './schemas/vehicle-compatibility.schema';
import { PlateLookupCacheModel, PlateLookupCacheSchema } from './schemas/plate-lookup-cache.schema';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { VehicleCompatibilityService } from './services/vehicle-compatibility.service';
import { VehicleCatalogUpsertService } from './services/vehicle-catalog-upsert.service';
import { PlateLookupService } from './services/plate-lookup.service';
import { PlateProviderClient } from './services/plate-provider.client';
import { VehicleCompatibilityController } from './controllers/vehicle-compatibility.controller';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: VehicleCompatibilityModel.name, schema: VehicleCompatibilitySchema },
      { name: PlateLookupCacheModel.name, schema: PlateLookupCacheSchema },
      // Registrados aqui (mesma collection do ProductModule) só para a checagem de uso em
      // getUsage/deactivate — evita import circular com ProductModule (que já importa este módulo).
      { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
      { name: ProductModel.name, schema: ProductSchema },
    ]),
  ],
  controllers: [VehicleCompatibilityController],
  providers: [VehicleCompatibilityService, VehicleCatalogUpsertService, PlateLookupService, PlateProviderClient],
  exports: [VehicleCompatibilityService, VehicleCatalogUpsertService],
})
export class VehicleCompatibilityModule {}
