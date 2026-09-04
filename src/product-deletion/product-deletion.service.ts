import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import { ProductDocument, ProductModel } from '../product/schemas/product.schema';
import { OrderModel, OrderDocument } from '../order/schemas/order.schema';
import { AllocationModel, AllocationDocument } from '../product/schemas/allocation.schema';
import { ListingService } from '../listing/listing.service';
import { ListingDocument } from '../listing/schemas/listing.schema';
import { ListingRemovalService } from '../marketplace-orchestrator/services/listing-removal.service';
import { NOTIFICATION_EVENTS, NotificationRequested } from '../notifications/events/notification.events';

/**
 * Exclusão completa de produto (admin-only) — cascata: marketplace → Listing → Product.
 * Ver docs/superpowers/specs/2026-09-04-admin-product-deletion-design.md.
 *
 * Fluxo em 2 fases porque a remoção de um Listing publicado é assíncrona (ListingRemovalService
 * enfileira via orchestrator; a confirmação só chega depois via SyncResultConsumer):
 *   Fase 1 (requestDeletion) — guard rails, enfileira DELETE por listing publicado, marca
 *   Product.deletionStatus='pending'. Se nenhum listing tinha externalId, finaliza no mesmo
 *   request (nada para esperar).
 *   Fase 2 (onListingRemovalResult, chamado pelo hook em SyncResultConsumer) — decrementa a
 *   lista de pendências; quando esvaziar sem falha, finaliza (stock + listings residuais +
 *   hard-delete do Product).
 */
@Injectable()
export class ProductDeletionService {
  private readonly logger = new Logger(ProductDeletionService.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(AllocationModel.name) private readonly allocationModel: Model<AllocationDocument>,
    private readonly listingService: ListingService,
    private readonly listingRemoval: ListingRemovalService,
    private readonly events: EventEmitter2,
  ) {}

  async requestDeletion(
    productId: string,
    requesterId?: string,
  ): Promise<{ deletionStatus: 'pending' | 'completed'; pendingMarketplaces: string[] }> {
    const product = await this.productModel.findById(productId).exec();
    if (!product) throw new NotFoundException(`Produto ${productId} não encontrado`);

    if (product.deletionStatus === 'pending') {
      throw new ConflictException(`Produto ${productId} já está em processo de exclusão.`);
    }

    await this.assertNoBlockingReferences(productId);

    const listings = await this.listingService.findByProduct(productId);
    const withExternalId = listings.filter((l) => !!l.externalId);
    const withoutExternalId = listings.filter((l) => !l.externalId);

    // Sem externalId: nunca publicou item real no marketplace — apaga local direto.
    for (const listing of withoutExternalId) {
      await this.listingService.delete(String(listing._id));
    }

    if (withExternalId.length === 0) {
      await this.finalizeDeletion(productId);
      return { deletionStatus: 'completed', pendingMarketplaces: [] };
    }

    const pendingListingIds: Types.ObjectId[] = [];
    const pendingMarketplaces: string[] = [];
    for (const listing of withExternalId) {
      await this.listingRemoval.removeListing(String(listing._id), requesterId);
      pendingListingIds.push(listing._id as Types.ObjectId);
      pendingMarketplaces.push(String(listing.marketplaceId));
    }

    await this.productModel.updateOne(
      { _id: productId },
      {
        $set: {
          deletionStatus: 'pending',
          deletionRequestedAt: new Date(),
          deletionRequestedBy: requesterId ? new Types.ObjectId(requesterId) : undefined,
          deletionPendingListingIds: pendingListingIds,
        },
        $unset: { deletionFailureReason: '' },
      },
    ).exec();

    return { deletionStatus: 'pending', pendingMarketplaces };
  }

  /**
   * Chamado pelo hook em SyncResultConsumer quando o resultado de um DELETE de listing chega.
   * No-op se o produto não estiver em `deletionStatus:'pending'` (DELETE originado de outro
   * fluxo, ex. moderação ou exclusão de anúncio avulsa).
   */
  async onListingRemovalResult(productId: string, listingId: string, success: boolean): Promise<void> {
    const product = await this.productModel.findById(productId).exec();
    if (!product || product.deletionStatus !== 'pending') return;

    const remaining = (product.deletionPendingListingIds ?? []).filter(
      (id) => String(id) !== String(listingId),
    );

    if (!success) {
      await this.productModel.updateOne(
        { _id: productId },
        {
          $set: {
            deletionStatus: 'failed',
            deletionFailureReason: `Falha ao remover anúncio ${listingId} do marketplace.`,
            deletionPendingListingIds: remaining,
          },
        },
      ).exec();
      return;
    }

    if (remaining.length > 0) {
      await this.productModel.updateOne(
        { _id: productId },
        { $set: { deletionPendingListingIds: remaining } },
      ).exec();
      return;
    }

    await this.finalizeDeletion(productId);
  }

  /**
   * Estado de uma exclusão em andamento. `deletionStatus: null` cobre tanto "nunca pedida"
   * quanto "já concluída" (o Product some do banco nesse caso) — o admin distingue os dois pelo
   * fato de já ter disparado o DELETE antes.
   */
  async getDeletionStatus(
    productId: string,
  ): Promise<{ deletionStatus: 'pending' | 'failed' | null; deletionFailureReason?: string }> {
    const product = await this.productModel
      .findById(productId, { deletionStatus: 1, deletionFailureReason: 1 })
      .exec();
    if (!product) return { deletionStatus: null };
    return {
      deletionStatus: product.deletionStatus ?? null,
      deletionFailureReason: product.deletionFailureReason,
    };
  }

  private async finalizeDeletion(productId: string): Promise<void> {
    await this.listingService.deleteByProduct(productId);
    await this.productModel.deleteOne({ _id: productId }).exec();

    const event: NotificationRequested = {
      type: 'product.deleted',
      aggregateType: 'system',
      aggregateId: productId,
      title: 'Produto excluído',
      body: `A exclusão do produto ${productId} foi concluída — anúncios, estoque e cadastro removidos.`,
      severity: 'success',
      channels: ['push', 'websocket', 'persist'],
      audience: { kind: 'all-admins' },
      data: { type: 'product-deletion', productId },
    };
    this.events.emit(NOTIFICATION_EVENTS.REQUESTED, event);

    this.logger.log(`Produto ${productId} excluído (cascata completa).`);
  }

  private async assertNoBlockingReferences(productId: string): Promise<void> {
    const pId = new Types.ObjectId(productId);

    const orderCount = await this.orderModel.countDocuments({ 'items.productId': pId }).exec();
    if (orderCount > 0) {
      throw new BadRequestException(
        `Produto ${productId} tem ${orderCount} pedido(s) associado(s) — não pode ser excluído.`,
      );
    }

    const allocationWithBox = await this.allocationModel
      .findOne({ 'boxes.products': pId })
      .exec();
    if (allocationWithBox) {
      throw new BadRequestException(
        `Produto ${productId} está alocado em uma caixa — remova-o da caixa antes de excluir.`,
      );
    }
  }
}
