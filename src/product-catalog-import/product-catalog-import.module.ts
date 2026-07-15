import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { BrandModel, BrandSchema } from '../product/schemas/brand.schema';
import { VehicleCompatibilityModel, VehicleCompatibilitySchema } from '../vehicle-compatibility/schemas/vehicle-compatibility.schema';
import { ProductCatalogImportController } from './product-catalog-import.controller';
import { ProductCatalogImportService } from './services/product-catalog-import.service';

@Module({
  imports: [
    MarketplaceModule,
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: CategoryModel.name, schema: CategorySchema },
      { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
      { name: VehicleCompatibilityModel.name, schema: VehicleCompatibilitySchema },
      { name: BrandModel.name, schema: BrandSchema },
    ]),
  ],
  controllers: [ProductCatalogImportController],
  providers: [ProductCatalogImportService],
})
export class ProductCatalogImportModule {}
