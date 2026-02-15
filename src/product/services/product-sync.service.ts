import { Injectable, Logger } from '@nestjs/common';
import { SearchService } from '../../search/search.service';
import { ProductModel } from '../schemas/product.schema';

@Injectable()
export class ProductSyncService {
    private readonly logger = new Logger(ProductSyncService.name);

    constructor(private readonly searchService: SearchService) { }

    async onModuleInit() {
        // SearchService handles index creation
    }

    async createIndexIfNotExists() {
        // Delegated to SearchService
        await this.searchService.createIndex();
    }

    async indexProduct(product: ProductModel | any) {
        return this.searchService.indexProduct(product);
    }

    async deleteProduct(productId: string) {
        // Implement delete in SearchService if needed, for now log
        this.logger.warn('Delete product from index not implemented in SearchService yet');
    }

    async bulkIndex(products: any[]) {
        // Use loop for now as SearchService doesn't expose bulk yet
        for (const product of products) {
            await this.searchService.indexProduct(product);
        }
    }


}
