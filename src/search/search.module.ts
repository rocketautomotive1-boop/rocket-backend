import { Module, forwardRef } from '@nestjs/common';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import { CategorySearchService } from './category-search.service';
import { ProductModule } from '../product/product.module';
import { CategoryDiscoveryService } from './category-discovery.service';
import { CategoryDiscoveryController } from './category-discovery.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
// import { CategoryMappingModel, CategoryMappingSchema } from '../marketplace/schemas/category-mapping.schema';
import { ListingModule } from '../listing/listing.module'; // [FIX]

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([
            { name: CategoryModel.name, schema: CategorySchema }
        ]),
        ElasticsearchModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
                const node = configService.get<string>('ELASTICSEARCH_NODE') || 'https://294bbba45fa142eb8b99c2e4269c164b.us-central1.gcp.cloud.es.io:443';
                console.log(`[SearchModule] Connecting to Elasticsearch node: ${node}`);
                return {
                    node,
                    auth: {
                        apiKey: configService.get<string>('ELASTICSEARCH_API_KEY') || 'N0lNamk1c0JseUpqbHhWLVljYXQ6NTZrSkN4VW91WEtTRmxIMl80V1lNdw=='
                    },
                    tls: {
                        rejectUnauthorized: false
                    },
                    maxRetries: 5,
                    requestTimeout: 60000,
                    sniffOnStart: false,
                    sniffOnConnectionFault: false,
                };
            },
            inject: [ConfigService],
        }),
        forwardRef(() => ProductModule),
        ListingModule, // [FIX] Import ListingModule
    ],
    controllers: [CategoryDiscoveryController],
    providers: [SearchService, CategorySearchService, CategoryDiscoveryService],
    exports: [SearchService, CategorySearchService, CategoryDiscoveryService],
})
export class SearchModule { }
