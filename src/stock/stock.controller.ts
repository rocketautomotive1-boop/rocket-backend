import { Controller, Get, Post, Param } from '@nestjs/common';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockQueryService } from './stock-query.service';

@Controller('stock')
export class StockController {
  constructor(
    private readonly reconciler: StockReconcilerService,
    private readonly query: StockQueryService,
  ) {}

  @Get('reconcile/health')
  health() {
    return this.reconciler.getHealth();
  }

  @Post('reconcile/run')
  run() {
    return this.reconciler.reconcileAll();
  }

  @Get(':productId/balance')
  async balance(@Param('productId') productId: string) {
    const [summary, avgCost] = await Promise.all([
      this.query.getProductStock(productId),
      this.query.getProductCost(productId),
    ]);
    return { ...summary, avgCost };
  }

  @Get(':productId/balance/by-condition')
  byCondition(@Param('productId') productId: string) {
    return this.query.getByCondition(productId);
  }

  @Get(':productId/balance/by-location')
  byLocation(@Param('productId') productId: string) {
    return this.query.getByLocation(productId);
  }
}
