import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';
import { PaginatedResponseDto } from './dto/product-filter.dto';

@Controller('store')
export class StoreProductController {
    constructor(private readonly productService: ProductService) { }

    @Get('products')
    async findAll(
        @Query('page') page = 1,
        @Query('limit') limit = 20,
        @Query('search') search?: string,
        @Query('featured') featured?: string
    ) {
        const isFeatured = featured === 'true';
        return this.productService.findForStore(+page, +limit, search, isFeatured);
    }

    @Get('products/:id')
    async findOne(@Param('id') id: string) {
        const product = await this.productService.findOne(id);
        if (!product) {
            throw new NotFoundException('Product not found');
        }
        // Calculate stock dynamically
        const stock = await this.productService.getProductStock(id);

        return {
            ...product,
            available_quantity: stock
        };
    }

    // Endpoint to get categories for the menu
    @Get('categories')
    async getCategories() {
        // product service doesn't have listCategories exposed directly?
        // We might need to access repository or add method.
        return []; // Placeholder
    }
}
