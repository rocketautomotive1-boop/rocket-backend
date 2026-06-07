import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { StockLedgerPort, StockItem } from '../order/ports/stock-ledger.port';
import { StockService } from './stock.service';
import { StockMovementType } from './domain/movement-type';

/**
 * The canonical implementation of the order's StockLedgerPort, now living in the StockModule.
 * Maps the order-facing contract onto StockService.move(). The order pipeline is untouched —
 * it keeps depending on the port.
 */
@Injectable()
export class StockLedgerProvider implements StockLedgerPort {
  constructor(private readonly stock: StockService) {}

  async deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[] }> {
    const movementIds: string[] = [];
    for (const it of items) {
      if (!it.productId || it.quantity <= 0) continue;
      const res = await this.stock.move(
        {
          productId: it.productId,
          type: StockMovementType.OUTBOUND,
          quantity: it.quantity,
          condition: 'new',
          orderId,
          reference,
          origin: { type: 'marketplace', location: marketplaceName },
        },
        session,
      );
      if (res.movementId) movementIds.push(res.movementId);
    }
    return { movementIds };
  }

  async revert(
    orderId: string,
    items: Array<StockItem & { unitPrice: number }>,
    reference: string,
  ): Promise<void> {
    for (const it of items) {
      if (!it.productId) continue;
      await this.stock.move({
        productId: it.productId,
        type: StockMovementType.INBOUND,
        quantity: it.quantity,
        condition: 'new',
        orderId,
        reference,
      });
    }
  }

  async deductStandalone(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
  ): Promise<{ status: string; movementsCount?: number; reason?: string }> {
    let count = 0;
    for (const it of items) {
      if (!it.productId || it.quantity <= 0) continue;
      const res = await this.stock.move({
        productId: it.productId,
        type: StockMovementType.OUTBOUND,
        quantity: it.quantity,
        condition: 'new',
        orderId,
        reference,
        origin: { type: 'marketplace', location: marketplaceName },
      });
      if (res.movementId) count++;
    }
    return { status: 'success', movementsCount: count };
  }
}
