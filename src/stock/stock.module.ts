import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockService } from './stock.service';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { StockLedgerProvider } from './stock-ledger.provider';
import { StockDivergenceReconcilerService } from './stock-divergence-reconciler.service';
import { StockController } from './stock.controller';
import { STOCK_QUERY_PORT, STORE_AWARE_STOCK_QUERY_PORT } from './ports/stock-query.port';
import { STOCK_WRITE_PORT } from './ports/stock-write.port';
import { STOCK_LEDGER_PORT } from '../order/ports/stock-ledger.port';
import { StoreListingModule } from '../store-listing/store-listing.module';
import { StoreListingModel, StoreListingSchema } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { AuthModule } from '../auth/auth.module';

/**
 * Single owner of stock: store_listing_stock_movements (immutable ledger),
 * store_listing_stock_lots (cost per condition), store_listing_stock_balances (materialized
 * projection) — owned by StoreListingModule, StockModule writes/reads them via
 * STORE_LISTING_PORT/StoreListingStockQueryService. Leaf module — imports no domain module;
 * receives productId as data. Exposes only ports (STOCK_LEDGER_PORT, STOCK_QUERY_PORT,
 * STORE_AWARE_STOCK_QUERY_PORT) to consumers.
 *
 * Contract complete (2026-08-29): the legacy aggregate-by-productId store
 * (stock_balances/stock_lots/stock_movements, StockRepository/StockQueryService/
 * StockReconcilerService) was removed after the dual-write inversion was validated in
 * production. See docs/superpowers/specs/2026-08-28-stock-contract-legacy-cutover-design.md
 * and docs/superpowers/specs/2026-08-29-stock-write-cutover-design.md.
 *
 * StockDivergenceReconcilerService replaces the safety net the legacy reconciler gave (daily
 * drift check between ledger and materialized balance) — detect + alert only, never auto-fix.
 * See docs/superpowers/specs/2026-08-29-stock-divergence-reconciler-design.md.
 *
 * Imports AuthModule for JwtAuthGuard (StockController's authenticated endpoints).
 *
 * @Global (mesmo padrão de StoreModule/MarketplaceConfigCacheModule): StoreListingModule
 * precisa de STOCK_QUERY_PORT/PRICING_PORT pra getAllocationProducts (join de estoque/preço),
 * mas já é importado por StockModule — um import de volta criaria ciclo real. @Global evita
 * isso sem forwardRef: StoreListingModule injeta o port sem importar o módulo.
 *
 * DI cycle fix (2026-08-29): StoreListingStockQueryService (o que STOCK_QUERY_PORT resolve) e
 * StockLedgerProvider injetam STORE_OWNER_LOOKUP_PORT (port folha, só findStoreIdByProduct), não
 * STORE_LISTING_PORT — usar o port completo aqui criava um ciclo real de instanciação com
 * StoreListingService (que injeta STOCK_QUERY_PORT para getAllocationProducts), travando o boot
 * silenciosamente em produção. StockService injeta STORE_LISTING_PORT completo (createOrGetStoreListing,
 * recordStockMovement, etc.) — não participa desse ciclo porque nada em StoreListingService
 * depende de StockService de volta.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreListingModel.name, schema: StoreListingSchema },
      { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
      { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
    ]),
    StoreListingModule,
    AuthModule,
  ],
  controllers: [StockController],
  providers: [
    StockService,
    StoreListingStockQueryService,
    StockLedgerProvider,
    StockDivergenceReconcilerService,
    { provide: STOCK_QUERY_PORT, useExisting: StoreListingStockQueryService },
    { provide: STORE_AWARE_STOCK_QUERY_PORT, useExisting: StoreListingStockQueryService },
    { provide: STOCK_LEDGER_PORT, useExisting: StockLedgerProvider },
    { provide: STOCK_WRITE_PORT, useExisting: StockService },
  ],
  exports: [STOCK_QUERY_PORT, STORE_AWARE_STOCK_QUERY_PORT, STOCK_LEDGER_PORT, STOCK_WRITE_PORT, StockService],
})
export class StockModule {}
