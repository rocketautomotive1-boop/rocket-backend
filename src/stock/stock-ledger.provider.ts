import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { StockLedgerPort, StockItem } from '../order/ports/stock-ledger.port';
import { StockService } from './stock.service';
import { StockMovementType } from './domain/movement-type';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { STORE_PORT, StorePort } from '../store/ports/store.port';

/**
 * The canonical implementation of the order's StockLedgerPort, now living in the StockModule.
 * Maps the order-facing contract onto StockService.move(). The order pipeline is untouched —
 * it keeps depending on the port.
 *
 * Fase 4: Order não tem noção de loja própria ainda (fica pra quando Order.items[].storeListingId
 * for preenchido, fora de escopo aqui) — resolve a loja dona de cada item via o StoreListing já
 * existente do produto (hoje um produto tem no máximo um StoreListing, então isso é
 * inequívoco). Fallback "Rocket Automotive" só se o produto não tiver NENHUM StoreListing ainda
 * (produto nunca visto pelas coleções novas) — mesmo critério do backfill da Fase 2.
 */
@Injectable()
export class StockLedgerProvider implements StockLedgerPort {
  private readonly logger = new Logger(StockLedgerProvider.name);

  constructor(
    private readonly stock: StockService,
    @Inject(STORE_LISTING_PORT) private readonly storeListingPort: StoreListingPort,
    @Inject(STORE_PORT) private readonly storePort: StorePort,
  ) {}

  private async resolveStoreId(productId: string): Promise<string | null> {
    const existing = await this.storeListingPort.findAnyByProduct(productId);
    if (existing) return existing.storeId.toString();
    const fallback = await this.storePort.findByName('Rocket Automotive');
    return fallback?.id ?? null;
  }

  async deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[]; items: StockItem[] }> {
    const movementIds: string[] = [];
    const deducted: StockItem[] = [];
    for (const it of items) {
      if (!it.productId || it.quantity <= 0) continue;
      const storeId = await this.resolveStoreId(it.productId);
      if (!storeId) {
        this.logger.error(`[Stock] loja não resolvida para produto ${it.productId} — item não deduzido para o pedido ${orderId}.`);
        continue;
      }
      const res = await this.stock.move(
        {
          productId: it.productId,
          storeId,
          type: StockMovementType.OUTBOUND,
          quantity: it.quantity,
          condition: 'new',
          orderId,
          reference,
          origin: { type: 'marketplace', location: marketplaceName },
        },
        session,
      );
      if (res.movementId) {
        movementIds.push(res.movementId);
        deducted.push(it);
      }
    }
    return { movementIds, items: deducted };
  }

  /**
   * Espelha os itens deduzidos por deductAndLink pra store_listing_stock_* — chamar SÓ depois
   * que a transação do chamador (a session passada pra deductAndLink) já comitou. Fire-and-log,
   * nunca lança: mesma garantia non-blocking do dual-write da Fase 3.
   */
  async mirrorAfterCommit(orderId: string, items: StockItem[]): Promise<void> {
    for (const it of items) {
      try {
        const storeId = await this.resolveStoreId(it.productId);
        if (!storeId) continue;
        await this.stock.mirrorMoveToStoreListing({
          productId: it.productId,
          storeId,
          type: StockMovementType.OUTBOUND,
          quantity: it.quantity,
          condition: 'new',
          orderId,
        } as any);
      } catch (err: any) {
        this.logger.error(`[Stock] falha ao espelhar item do pedido ${orderId} (produto ${it.productId}) pós-commit: ${err?.message}`);
      }
    }
  }

  async revert(
    orderId: string,
    items: Array<StockItem & { unitPrice: number }>,
    reference: string,
  ): Promise<void> {
    for (const it of items) {
      if (!it.productId) continue;
      const storeId = await this.resolveStoreId(it.productId);
      if (!storeId) {
        this.logger.error(`[Stock] loja não resolvida para produto ${it.productId} — reversão do pedido ${orderId} não aplicada para este item.`);
        continue;
      }
      await this.stock.move({
        productId: it.productId,
        storeId,
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
      const storeId = await this.resolveStoreId(it.productId);
      if (!storeId) {
        this.logger.error(`[Stock] loja não resolvida para produto ${it.productId} — item não deduzido para o pedido ${orderId}.`);
        continue;
      }
      const res = await this.stock.move({
        productId: it.productId,
        storeId,
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
