import { Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MigrationService } from '../services/migration.service';
import { CatalogMigrationService } from '../services/catalog-migration.service';

@ApiTags('migration')
@Controller('migration')
export class MigrationController {
    constructor(
        private readonly migrationService: MigrationService,
        private readonly catalogMigrationService: CatalogMigrationService
    ) { }

    @Post('brands')
    @ApiOperation({ summary: 'Migrate brands from products to Brands collection' })
    async migrateBrands() {
        return this.migrationService.migrateBrands();
    }

    @Post('categories')
    @ApiOperation({ summary: 'Migrate categories from products to Categories collection' })
    async migrateCategories() {
        return this.migrationService.migrateCategories();
    }

    @Post('templates')
    @ApiOperation({ summary: 'Migrate/Seed default description templates' })
    async migrateTemplates() {
        return this.migrationService.migrateDescriptionTemplates();
    }

    @Post('oem-codes')
    @ApiOperation({ summary: 'Migrate/Denormalize OEM Codes from groups to products' })
    async migrateOemCodes() {
        return this.catalogMigrationService.migrateOemCodes();
    }
}
