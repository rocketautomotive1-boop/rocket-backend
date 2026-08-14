import { Controller, Get, Post, Param, Body, Req, UseGuards, Inject, BadRequestException } from '@nestjs/common';
import { StockReconcilerService } from './stock-reconciler.service';
import { StockService } from './stock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';

@Controller('stock')
export class StockController {
  constructor(
    private readonly reconciler: StockReconcilerService,
    private readonly stock: StockService,
    @Inject(STORE_LISTING_PORT) private readonly storeListingPort: StoreListingPort,
  ) {}

  private requireStoreId(req: any): string {
    const storeId = req?.user?.storeId;
    if (!storeId) {
      throw new BadRequestException('Usuário sem loja configurada — não é possível consultar estoque.');
    }
    return storeId;
  }

  @Get('reconcile/health')
  health() {
    return this.reconciler.getHealth();
  }

  @Post('reconcile/run')
  run() {
    return this.reconciler.reconcileAll();
  }

  @Get(':productId/balance')
  @UseGuards(JwtAuthGuard)
  async balance(@Param('productId') productId: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    const summary = await this.storeListingPort.getStockSummary(productId, storeId);
    return { productId, ...summary };
  }

  @Get(':productId/balance/by-condition')
  @UseGuards(JwtAuthGuard)
  byCondition(@Param('productId') productId: string, @Req() req: any) {
    return this.storeListingPort.getStockByCondition(productId, this.requireStoreId(req));
  }

  @Get(':productId/balance/by-location')
  @UseGuards(JwtAuthGuard)
  byLocation(@Param('productId') productId: string, @Req() req: any) {
    return this.storeListingPort.getStockByLocation(productId, this.requireStoreId(req));
  }

  @Post(':productId/correct-to')
  @UseGuards(JwtAuthGuard)
  async correctTo(
    @Param('productId') productId: string,
    @Body() body: { quantity?: number; condition?: 'new' | 'damaged' | 'used' | 'refurbished' },
    @Req() req: any,
  ) {
    if (typeof body?.quantity !== 'number' || !Number.isInteger(body.quantity) || body.quantity < 0) {
      throw new BadRequestException('quantity deve ser um inteiro >= 0');
    }
    const storeId = this.requireStoreId(req);
    const result = await this.stock.correctTo({
      productId,
      storeId,
      targetQuantity: body.quantity,
      condition: body.condition,
    });
    return result ?? { message: 'Estoque já estava correto, nenhum ajuste necessário.' };
  }
}
