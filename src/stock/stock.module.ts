import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockMovementModel, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockLotModel, StockLotSchema } from './schemas/stock-lot.schema';
import { StockBalanceModel, StockBalanceSchema } from './schemas/stock-balance.schema';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { StockQueryService } from './stock-query.service';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockLedgerProvider } from './stock-ledger.provider';
import { StockController } from './stock.controller';
import { STOCK_QUERY_PORT } from './ports/stock-query.port';
import { STOCK_LEDGER_PORT } from '../order/ports/stock-ledger.port';
import { StoreListingModule } from '../store-listing/store-listing.module';
import { StoreListingModel, StoreListingSchema } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { AuthModule } from '../auth/auth.module';

/**
 * Single owner of stock: stock_movements (immutable ledger), stock_lots (cost per condition),
 * stock_balances (materialized projection). Leaf module — imports no domain module; receives
 * productId as data. Exposes only ports (STOCK_LEDGER_PORT, STOCK_QUERY_PORT) to consumers.
 *
 * Fase 3 (dual-write): importa StoreListingModule pra injetar STORE_LISTING_PORT — StockService
 * espelha todo move() bem-sucedido em store_listing_stock_* sem nunca bloquear/falhar o legado
 * (fire-and-log). STORE_PORT vem de StoreModule, que é @Global (não precisa de import aqui).
 *
 * Fase 4 (leitura/escrita store-aware): importa AuthModule pra JwtAuthGuard (StockController
 * ganhou endpoints autenticados) — JwtAuthGuard depende de JwtService, que só existe no
 * contexto de um módulo que importe AuthModule.
 *
 * @Global (mesmo padrão de StoreModule/MarketplaceConfigCacheModule): StoreListingModule
 * precisa de STOCK_QUERY_PORT/PRICING_PORT pra getAllocationProducts (join de estoque/preço),
 * mas já é importado por StockModule (dual-write acima) — um import de volta criaria ciclo
 * real. @Global evita isso sem forwardRef: StoreListingModule injeta o port sem importar o
 * módulo.
 *
 * Contract (sub-projeto 4, 2026-08-28): STOCK_QUERY_PORT aponta para
 * StoreListingStockQueryService (lê StoreListing, resolvendo a loja dona do produto via
 * STORE_LISTING_PORT.findAnyByProduct — mesma regra que o pipeline de pedidos já usa), não mais
 * para StockQueryService (legado, stock_balances). StockQueryService continua registrado até a
 * remoção completa do legado (schemas/repository/reconciler) — ver
 * docs/superpowers/specs/2026-08-28-stock-contract-legacy-cutover-design.md. Os schemas de
 * StoreListing precisam de forFeature próprio aqui: Mongoose exige registro por módulo mesmo
 * quando a collection já está registrada em outro (StoreListingModule só exporta o port, não os
 * models).
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockMovementModel.name, schema: StockMovementSchema },
      { name: StockLotModel.name, schema: StockLotSchema },
      { name: StockBalanceModel.name, schema: StockBalanceSchema },
      { name: StoreListingModel.name, schema: StoreListingSchema },
      { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
      { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
    ]),
    StoreListingModule,
    AuthModule,
  ],
  controllers: [StockController],
  providers: [
    StockRepository,
    StockService,
    StockQueryService,
    StoreListingStockQueryService,
    StockReconcilerService,
    StockLedgerProvider,
    { provide: STOCK_QUERY_PORT, useExisting: StoreListingStockQueryService },
    { provide: STOCK_LEDGER_PORT, useExisting: StockLedgerProvider },
  ],
  exports: [STOCK_QUERY_PORT, STOCK_LEDGER_PORT, StockService, StockQueryService],
})
export class StockModule {}
