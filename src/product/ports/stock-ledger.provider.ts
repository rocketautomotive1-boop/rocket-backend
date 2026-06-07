import { Injectable, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockLedgerPort, StockItem } from '../../order/ports/stock-ledger.port';
import { ProductMovementService } from '../services/product-movement.service';
import { ProductRepository } from '../product.repository';

/**
 * Product-owned implementation of the order's StockLedgerPort.
 * This is the single home for sale-driven stock movements (deduction / reversal),
 * replacing the order-side StockOrchestratorService. Keeps stock logic in the product
 * domain so `product` no longer needs to import `order`.
 */
@Injectable()
export class StockLedgerProvider implements StockLedgerPort {
  private readonly logger = new Logger(StockLedgerProvider.name);

  constructor(
    private readonly movements: ProductMovementService,
    private readonly productRepository: ProductRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[] }> {
    const already = await this.movements.existsReference(reference);
    if (already) {
      this.logger.warn(`[StockLedger] ref ${reference} already processed. Skipping.`);
      return { movementIds: [] };
    }

    const movementIds: string[] = [];
    for (const item of items) {
      if (!item.productId || item.quantity <= 0) continue;
      const m = await this.movements.create(
        {
          productId: item.productId,
          orderId,
          type: 'outbound',
          quantity: item.quantity,
          reason: `Venda ${marketplaceName}`,
          reference,
          condition: 'new',
          origin: { type: 'marketplace', location: marketplaceName },
          status: 'completed',
        } as any,
        session,
      );
      movementIds.push(m._id?.toString() ?? m.id);
      this.logger.debug(`[StockLedger] deductAndLink -${item.quantity} product=${item.productId} ref=${reference}`);
    }
    return { movementIds };
  }

  async revert(
    orderId: string,
    items: Array<StockItem & { unitPrice: number }>,
    reference: string,
  ): Promise<void> {
    for (const item of items) {
      if (!item.productId) continue;
      await this.movements.create({
        productId: item.productId,
        type: 'inbound',
        quantity: item.quantity,
        price: item.unitPrice,
        orderId,
        reference,
        notes: `Estorno por cancelamento (${reference})`,
      } as any);
    }
  }

  async deductStandalone(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
  ): Promise<{ status: string; movementsCount?: number; reason?: string }> {
    const session = await this.productRepository.getConnection().startSession();
    session.startTransaction();
    try {
      const exists = await this.movements.existsReference(reference);
      if (exists) {
        this.logger.warn(`[StockLedger] deductStandalone: ref ${reference} already processed. Skipping.`);
        await session.abortTransaction();
        return { status: 'skipped', reason: 'already_processed' };
      }

      const created: any[] = [];
      for (const item of items) {
        if (!item.productId || item.quantity <= 0) continue;
        const m = await this.movements.create(
          {
            productId: item.productId,
            orderId,
            type: 'outbound',
            quantity: item.quantity,
            reason: `Venda ${marketplaceName}`,
            reference,
            condition: 'new',
            origin: { type: 'marketplace', location: marketplaceName },
            status: 'completed',
          } as any,
          session,
        );
        created.push(m);
      }

      await session.commitTransaction();

      for (const mov of created) {
        this.eventEmitter.emit('product.movement_created', mov);
      }

      return { status: 'success', movementsCount: created.length };
    } catch (err) {
      await session.abortTransaction();
      this.logger.error(`[StockLedger] deductStandalone failed for ${reference}`, err as Error);
      throw err;
    } finally {
      session.endSession();
    }
  }
}
