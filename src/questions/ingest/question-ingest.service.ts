import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { QuestionRepository } from '../question.repository';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { MercadoLivreService } from '../../marketplace/services/mercado-livre.service';
import { ProductService } from '../../product/product.service';
import {
  PRODUCT_RESOLVER_PORT,
  ProductResolverPort,
} from '../../order/ports/product-resolver.port';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import { decideQuestionAction, QuestionIngestSource } from './question-ingest.decision';

@Injectable()
export class QuestionIngestService {
  private readonly logger = new Logger(QuestionIngestService.name);

  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly mercadoLivreAdapter: MercadoLivreAdapter,
    private readonly mercadoLivreService: MercadoLivreService,
    private readonly productService: ProductService,
    @Inject(PRODUCT_RESOLVER_PORT)
    private readonly productResolver: ProductResolverPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async ingest(
    externalQuestionId: string,
    source: QuestionIngestSource = 'webhook',
    accountId?: string,
  ): Promise<void> {
    const marketplaces = await this.marketplaceRegistry.findAll();
    const mkt = marketplaces.find((m: any) => m.enabled && m.name === 'Mercado Livre');
    if (!mkt) return;

    // Multi-client: o MlHttpClient resolve/renova o token da conta (accountId)
    // dentro do getQuestionById; sem token resolvido aqui.
    let q: any;
    try {
      q = await this.mercadoLivreAdapter.getQuestionById(externalQuestionId, accountId);
    } catch { return; }
    if (!q) return;

    const existing = await this.questionRepository.findOne({ externalId: String(q.id) });
    const action = decideQuestionAction(
      existing
        ? { status: existing.status, product: existing.product, notified: (existing as any).notified }
        : null,
      { status: q.status, hasAnswer: !!q.answer },
    );
    this.logger.log(`[Ingest] question ${q.id} action=${action.kind} source=${source}`);

    switch (action.kind) {
      case 'SKIP':
        return;
      case 'UPDATE_ANSWER':
        existing!.answer = q.answer?.text ?? existing!.answer;
        existing!.status = 'ANSWERED';
        existing!.dateAnswered = q.answer ? new Date(q.answer.date_created) : new Date();
        existing!.responseTimeMinutes = q.answer
          ? Math.round((new Date(q.answer.date_created).getTime() - new Date(existing!.dateCreated).getTime()) / 60000)
          : existing!.responseTimeMinutes;
        await existing!.save();
        return;
      case 'LINK_PRODUCT': {
        const pid = await this.resolveProductId(q.item_id, mkt._id);
        if (pid) {
          existing!.product = pid;
          existing!.itemId = q.item_id;
          await existing!.save();
        }
        return;
      }
      case 'RECOVER_NOTIFICATION':
        await this.emitNotification(q, (existing!.product as any) ?? null);
        (existing as any).notified = true;
        await existing!.save();
        return;
      case 'CREATE': {
        const pid = await this.resolveProductId(q.item_id, mkt._id);
        const status = q.status === 'ANSWERED' ? 'ANSWERED' : 'UNANSWERED';
        const created = await this.questionRepository.create({
          externalId: String(q.id),
          itemId: q.item_id,
          question: q.text,
          status,
          dateCreated: new Date(q.date_created),
          marketplaceId: mkt._id,
          product: pid,
          buyerId: String(q.from?.id),
          buyerName: q.from?.nickname || null,
          answer: q.answer ? q.answer.text : null,
          dateAnswered: q.answer ? new Date(q.answer.date_created) : null,
          responseTimeMinutes: q.answer
            ? Math.round((new Date(q.answer.date_created).getTime() - new Date(q.date_created).getTime()) / 60000)
            : null,
          notified: false,
        });
        if (status === 'UNANSWERED') {
          await this.emitNotification(q, pid);
          (created as any).notified = true;
          await created.save();
        }
        return;
      }
    }
  }

  /**
   * Resolve internal product _id from the ML item id via the single canonical
   * PRODUCT_RESOLVER_PORT (alias → sku-alias → title → listing → title-match).
   * When the cheap externalId lookups miss, we enrich with the ML item's SKU and
   * title (one getItem call) so the resolver can match by SELLER_SKU and create
   * the alias for next time — preserving the old auto-link-by-SKU behaviour.
   */
  private async resolveProductId(
    itemId: string,
    marketplaceId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    if (!itemId) return null;
    const mktId = marketplaceId.toString();

    // Cheap path: externalId-only resolution (alias/title/listing).
    let pid = await this.productResolver.resolveProduct(itemId, '', mktId);
    if (!pid) {
      // Enrich with SKU + title from the live ML item, then retry.
      const { sku, title } = await this.fetchItemSkuAndTitle(itemId);
      if (sku || title) {
        pid = await this.productResolver.resolveProduct(itemId, sku, mktId, title);
      }
    }

    return pid ? new Types.ObjectId(pid) : null;
  }

  private async fetchItemSkuAndTitle(itemId: string): Promise<{ sku: string; title: string }> {
    try {
      const item = await this.mercadoLivreService.getItem(itemId);
      const sku =
        item?.seller_custom_field ||
        item?.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name ||
        '';
      return { sku: String(sku || ''), title: String(item?.title || '') };
    } catch (e) {
      this.logger.warn(`[Resolve] getItem failed for ${itemId}: ${(e as Error).message}`);
      return { sku: '', title: '' };
    }
  }

  private async emitNotification(q: any, productId: Types.ObjectId | null): Promise<void> {
    const externalId = String(q.id);
    const productName = await this.resolveProductName(productId);
    const subject = productName || q.item_id;

    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'question.received',
      aggregateType: 'question',
      aggregateId: externalId,
      title: 'Nova Pergunta!',
      body: `${(q.text ?? '').substring(0, 100)} - ${subject}`,
      data: {
        actionRoute: `/(drawer)/questions?focus=${externalId}`,
        externalId,
        productId: productId ? productId.toString() : null,
        marketplace: 'mercadolivre',
      },
      channels: ['push', 'websocket', 'persist'],
      severity: 'info',
      deduplicationKey: `question:mercadolivre:${q.id}`,
      source: 'webhook',
    });
  }

  private async resolveProductName(productId: Types.ObjectId | null): Promise<string | null> {
    if (!productId) return null;
    try {
      const product: any = await this.productService.findOne(productId.toString(), { lean: true });
      return product?.name || null;
    } catch (e) {
      this.logger.warn(`[Notify] product name lookup failed for ${productId}: ${(e as Error).message}`);
      return null;
    }
  }
}
