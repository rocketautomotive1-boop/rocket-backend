import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { LegalEntityModule } from '../legal-entity/legal-entity.module';
import { ProductModule } from '../product/product.module';
import { CostSimulationController } from './cost-simulation.controller';
import { CostSimulationService } from './cost-simulation.service';
import { MlFeesAdapter } from './adapters/ml-fees.adapter';
import { FiscalRateAdapter } from './adapters/fiscal-rate.adapter';
import { ProductDataAdapter } from './adapters/product-data.adapter';
import { MARKETPLACE_FEES_PORT, FISCAL_RATE_PORT, PRODUCT_DATA_PORT } from './ports';

@Module({
  imports: [MarketplaceModule, LegalEntityModule, ProductModule],
  controllers: [CostSimulationController],
  providers: [
    CostSimulationService,
    { provide: MARKETPLACE_FEES_PORT, useClass: MlFeesAdapter },
    { provide: FISCAL_RATE_PORT, useClass: FiscalRateAdapter },
    { provide: PRODUCT_DATA_PORT, useClass: ProductDataAdapter },
  ],
})
export class CostSimulationModule {}
