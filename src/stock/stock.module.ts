import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockMovementModel, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockLotModel, StockLotSchema } from './schemas/stock-lot.schema';
import { StockBalanceModel, StockBalanceSchema } from './schemas/stock-balance.schema';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { StockQueryService } from './stock-query.service';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockLedgerProvider } from './stock-ledger.provider';
import { StockController } from './stock.controller';
import { STOCK_QUERY_PORT } from './ports/stock-query.port';
import { STOCK_LEDGER_PORT } from '../order/ports/stock-ledger.port';

/**
 * Single owner of stock: stock_movements (immutable ledger), stock_lots (cost per condition),
 * stock_balances (materialized projection). Leaf module — imports no domain module; receives
 * productId as data. Exposes only ports (STOCK_LEDGER_PORT, STOCK_QUERY_PORT) to consumers.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockMovementModel.name, schema: StockMovementSchema },
      { name: StockLotModel.name, schema: StockLotSchema },
      { name: StockBalanceModel.name, schema: StockBalanceSchema },
    ]),
  ],
  controllers: [StockController],
  providers: [
    StockRepository,
    StockService,
    StockQueryService,
    StockReconcilerService,
    StockLedgerProvider,
    { provide: STOCK_QUERY_PORT, useExisting: StockQueryService },
    { provide: STOCK_LEDGER_PORT, useExisting: StockLedgerProvider },
  ],
  exports: [STOCK_QUERY_PORT, STOCK_LEDGER_PORT, StockService, StockQueryService],
})
export class StockModule {}
