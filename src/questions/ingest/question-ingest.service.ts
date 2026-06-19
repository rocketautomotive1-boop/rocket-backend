import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QuestionRepository } from '../question.repository';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { QuestionProductResolver } from '../resolve/question-product.resolver';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import { decideQuestionAction, QuestionIngestSource } from './question-ingest.decision';

@Injectable()
export class QuestionIngestService {
  private readonly logger = new Logger(QuestionIngestService.name);

  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly marketplaceAuth: MarketplaceAuthService,
    private readonly broker: MarketplaceTokenBrokerService,
    private readonly mercadoLivreAdapter: MercadoLivreAdapter,
    private readonly resolver: QuestionProductResolver,
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

    // Multi-client: token da conta que originou a pergunta (accountId) quando
    // conhecido; senão conta default (legado/single-account).
    let token: string | undefined;
    try {
      const active = accountId
        ? await this.broker.ensureValidTokenByAccount(String(mkt._id), accountId)
        : await this.marketplaceAuth.ensureValidToken(mkt._id);
      token = active?.accessToken;
    } catch { return; }
    if (!token) return;

    const q = await this.mercadoLivreAdapter.getQuestionById(token, externalQuestionId);
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
        const pid = await this.resolver.resolve(q.item_id, mkt, token);
        if (pid) {
          existing!.product = pid;
          existing!.itemId = q.item_id;
          await existing!.save();
        }
        return;
      }
      case 'RECOVER_NOTIFICATION':
        this.emitNotification(q);
        (existing as any).notified = true;
        await existing!.save();
        return;
      case 'CREATE': {
        const pid = await this.resolver.resolve(q.item_id, mkt, token);
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
          this.emitNotification(q);
          (created as any).notified = true;
          await created.save();
        }
        return;
      }
    }
  }

  private emitNotification(q: any): void {
    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'question.received',
      aggregateType: 'question',
      aggregateId: String(q.id),
      title: 'Nova Pergunta!',
      body: `${(q.text ?? '').substring(0, 100)} - ${q.item_id}`,
      data: {
        actionRoute: '/(drawer)/questions',
        externalId: String(q.id),
        marketplace: 'mercadolivre',
      },
      channels: ['push', 'websocket', 'persist'],
      severity: 'info',
      deduplicationKey: `question:mercadolivre:${q.id}`,
      source: 'webhook',
    });
  }
}
