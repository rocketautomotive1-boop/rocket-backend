import { BadRequestException, Controller, Post, Body } from '@nestjs/common';
import { ZodError } from 'zod';
import { ImportCatalogService } from '../services/import-catalog.service';
import { importCatalogRequestSchema } from '../dto/import-catalog.dto';

/**
 * Bulk import for products scraped from manufacturer desktop catalog apps
 * (see tools/catalog-extractor). Idempotent by partNumber — safe to re-post
 * the same export.
 */
@Controller('product/import-catalog')
export class ImportCatalogController {
  constructor(private readonly importCatalogService: ImportCatalogService) {}

  @Post()
  async importCatalog(@Body() body: unknown) {
    let parsed;
    try {
      parsed = importCatalogRequestSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException(e.issues.map((i) => i.message).join('; '));
      }
      throw e;
    }

    return this.importCatalogService.importItems(parsed.items);
  }
}
