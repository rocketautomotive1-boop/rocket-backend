import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CategorySearchService } from './category-search.service';
import { ProductModule } from '../product/product.module';
import { CategoryDiscoveryService } from './category-discovery.service';
import { CategoryDiscoveryController } from './category-discovery.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { ListingModule } from '../listing/listing.module';
// CategoryDiscoveryService and CategorySearchService use MongoDB Atlas Search ($search aggregation).
// Elasticsearch (and the former product SearchService) was removed.

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([
            { name: CategoryModel.name, schema: CategorySchema }
        ]),
        forwardRef(() => ProductModule),
        ListingModule, // [FIX] Import ListingModule
    ],
    controllers: [CategoryDiscoveryController],
    providers: [CategorySearchService, CategoryDiscoveryService],
    exports: [CategorySearchService, CategoryDiscoveryService],
})
export class SearchModule { }
