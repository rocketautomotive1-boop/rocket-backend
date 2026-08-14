import { Controller, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MigrationService } from '../services/migration.service';
import { CatalogMigrationService } from '../services/catalog-migration.service';
import { ProductShortTitleMigrationService } from '../services/product-short-title-migration.service';

@ApiTags('migration')
@Controller('migration')
export class MigrationController {
    constructor(
        private readonly migrationService: MigrationService,
        private readonly catalogMigrationService: CatalogMigrationService,
        private readonly shortTitleMigrationService: ProductShortTitleMigrationService,
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

    @Post('part-number-keys')
    @ApiOperation({ summary: 'Backfill Product.partNumberKey from Product.partNumber' })
    async migratePartNumberKeys() {
        return this.catalogMigrationService.migratePartNumberKeys();
    }

    @Post('cross-reference-codes')
    @ApiOperation({ summary: 'Migrate legacy embedded cross-reference codes[] into the cross_reference_codes collection. Pass ?dryRun=true to only count conflicts without writing.' })
    async migrateCrossReferenceCodes(@Query('dryRun') dryRun?: string) {
        return this.catalogMigrationService.migrateCrossReferenceCodes({ dryRun: dryRun === 'true' });
    }

    @Post('cross-reference-ghost-brands')
    @ApiOperation({ summary: 'Flag ghost-brand duplicate codes (e.g. SIMILAR/DIVERSOS) for manual discard review. Pass ?dryRun=true to only count candidates without writing. Run after cross-reference-codes.' })
    async flagGhostBrandDuplicates(@Query('dryRun') dryRun?: string) {
        return this.catalogMigrationService.flagGhostBrandDuplicates({ dryRun: dryRun === 'true' });
    }

    @Post('activate-all-inactive-products')
    @ApiOperation({ summary: 'Set active:true on every Product currently active:false (backfill for catalog imports that used to default to active:false). WARNING: also reactivates any product manually soft-deleted via ProductService.remove() — no field distinguishes the two cases. Pass ?dryRun=true to only count without writing.' })
    async activateAllInactiveProducts(@Query('dryRun') dryRun?: string) {
        return this.catalogMigrationService.activateAllInactiveProducts({ dryRun: dryRun === 'true' });
    }

    @Post('display-name-to-short-title')
    @ApiOperation({ summary: 'Migrate legacy Product.displayName (free string) into ProductShortTitle (reusable) + Product.titleId. subtitle is left blank (no automatic split). Pass ?dryRun=true to only count without writing.' })
    async migrateDisplayNameToShortTitle(@Query('dryRun') dryRun?: string) {
        return this.shortTitleMigrationService.migrateDisplayNameToShortTitle({ dryRun: dryRun === 'true' });
    }
}
