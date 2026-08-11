import { Controller, Get, Post, Param, Body, BadRequestException } from '@nestjs/common';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockQueryService } from './stock-query.service';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(
    private readonly reconciler: StockReconcilerService,
    private readonly query: StockQueryService,
    private readonly stock: StockService,
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

  @Post(':productId/correct-to')
  async correctTo(
    @Param('productId') productId: string,
    @Body() body: { quantity?: number; condition?: 'new' | 'damaged' | 'used' | 'refurbished' },
  ) {
    if (typeof body?.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity < 0) {
      throw new BadRequestException('quantity deve ser um inteiro >= 0');
    }
    const result = await this.stock.correctTo({
      productId,
      targetQuantity: body.quantity,
      condition: body.condition,
    });
    return result ?? { message: 'Estoque já estava correto, nenhum ajuste necessário.' };
  }
}
