import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProductCatalogImportService } from './services/product-catalog-import.service';
import { ConfirmCatalogImportDto } from './dto/product-catalog-import.dto';

/**
 * Pré-cadastro de produto via catálogo do Mercado Livre (busca por EAN).
 * Ver docs/superpowers/specs/2026-07-15-product-catalog-import-design.md.
 */
@Controller('product-catalog-import')
export class ProductCatalogImportController {
  constructor(private readonly service: ProductCatalogImportService) {}

  @Get('search')
  async search(@Query('ean') ean: string) {
    return this.service.search(ean);
  }

  @Get('resolve')
  async resolve(@Query('catalogProductId') catalogProductId: string) {
    return this.service.resolve(catalogProductId);
  }

  @Post('confirm')
  async confirm(@Body() dto: ConfirmCatalogImportDto) {
    return this.service.confirm(dto);
  }
}
