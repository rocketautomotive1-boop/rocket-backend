import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { StockLedgerPort, StockItem } from '../order/ports/stock-ledger.port';
import { StockService } from './stock.service';
import { StockMovementType } from './domain/movement-type';
import { STORE_OWNER_LOOKUP_PORT, StoreOwnerLookupPort } from '../store-listing/ports/store-owner-lookup.port';

/**
 * The canonical implementation of the order's StockLedgerPort, now living in the StockModule.
 * Maps the order-facing contract onto StockService.move(). The order pipeline is untouched —
 * it keeps depending on the port.
 *
 * Fase 4/Contract: Order não tem noção de loja própria ainda (fica pra quando
 * Order.items[].storeListingId for preenchido, fora de escopo aqui) — resolve a loja dona de cada
 * item via o StoreListing já existente do produto (hoje um produto tem no máximo um StoreListing,
 * então isso é inequívoco), via STORE_OWNER_LOOKUP_PORT — port folha, não STORE_LISTING_PORT
 * inteiro (ver store-owner-lookup.port.ts pro motivo: injetar STORE_LISTING_PORT aqui, junto com
 * StoreListingService dependendo de STOCK_QUERY_PORT, criava um ciclo real de instanciação). SEM
 * fallback pra loja padrão (removido em 2026-08-28, ver
 * docs/superpowers/specs/2026-08-28-stock-contract-legacy-cutover-design.md): produto sem NENHUM
 * StoreListing bloqueia a dedução daquele item explicitamente, mesmo princípio já aplicado ao
 * roteamento de publish (accountId ausente bloqueia, nunca adivinha a loja).
 */
@Injectable()
export class StockLedgerProvider implements StockLedgerPort {
  private readonly logger = new Logger(StockLedgerProvider.name);

  constructor(
    private readonly stock: StockService,
    @Inject(STORE_OWNER_LOOKUP_PORT) private readonly storeOwnerLookup: StoreOwnerLookupPort,
  ) {}

  private async resolveStoreId(productId: string): Promise<string | null> {
    return this.storeOwnerLookup.findStoreIdByProduct(productId);
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
