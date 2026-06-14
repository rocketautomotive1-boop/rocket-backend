import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { ProductModule } from '../product/product.module';
import { CostSimulationController } from './cost-simulation.controller';
import { CostSimulationService } from './cost-simulation.service';
import { MlFeesAdapter } from './adapters/ml-fees.adapter';
import { FiscalRateAdapter } from './adapters/fiscal-rate.adapter';
import { StockCostAdapter } from './adapters/stock-cost.adapter';
import { MARKETPLACE_FEES_PORT, FISCAL_RATE_PORT, STOCK_COST_PORT } from './ports';

@Module({
  imports: [MarketplaceModule, FiscalModule, ProductModule],
  controllers: [CostSimulationController],
  providers: [
    CostSimulationService,
    { provide: MARKETPLACE_FEES_PORT, useClass: MlFeesAdapter },
    { provide: FISCAL_RATE_PORT, useClass: FiscalRateAdapter },
    { provide: STOCK_COST_PORT, useClass: StockCostAdapter },
  ],
})
export class CostSimulationModule {}
