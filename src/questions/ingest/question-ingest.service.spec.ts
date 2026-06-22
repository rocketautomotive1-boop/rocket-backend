import { Types } from 'mongoose';
import { QuestionIngestService } from './question-ingest.service';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

const mlMarketplace = { _id: new Types.ObjectId(), enabled: true, name: 'Mercado Livre' };

function makeSut(existing: any) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue({ status: 'UNANSWERED', save: jest.fn() }),
  };
  const registry = { findAll: jest.fn().mockResolvedValue([mlMarketplace]) };
  // O token/refresh agora vivem no MlHttpClient dentro do adapter; o ingest só
  // chama getQuestionById(externalId, accountId).
  const adapter = {
    getQuestionById: jest.fn().mockResolvedValue({
      id: 99, item_id: 'MLB1', text: 'oi?', status: 'UNANSWERED',
      date_created: new Date().toISOString(), from: { id: 1, nickname: 'b' },
    }),
  };
  const mlService = {
    getItem: jest.fn().mockResolvedValue({ seller_custom_field: 'SKU1', title: 'Item' }),
  };
  const productService = {
    findOne: jest.fn().mockResolvedValue({ name: 'Produto X' }),
  };
  // Canonical resolver port: resolveProduct(externalItemId, sku, marketplaceId, title).
  const resolver = { resolveProduct: jest.fn().mockResolvedValue(new Types.ObjectId().toString()) };
  const emitter = { emit: jest.fn() };
  const sut = new QuestionIngestService(
    repo as any, registry as any, adapter as any,
    mlService as any, productService as any, resolver as any, emitter as any,
  );
  return { sut, repo, emitter, resolver, adapter, mlService, productService };
}

describe('QuestionIngestService', () => {
  it('CREATE: new question creates doc and emits notification', async () => {
    const { sut, repo, emitter } = makeSut(null);
    await sut.ingest('99', 'webhook');
    expect(repo.create).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      type: 'question.received', aggregateId: '99',
    }));
  });

  it('CREATE: resolves product via canonical port and enriches the notification', async () => {
    const { sut, emitter, resolver, productService } = makeSut(null);
    await sut.ingest('99', 'webhook');
    // First a cheap externalId-only lookup; on miss, retried with SKU+title.
    expect(resolver.resolveProduct).toHaveBeenCalled();
    expect(productService.findOne).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      body: expect.stringContaining('Produto X'),
      data: expect.objectContaining({ actionRoute: '/(drawer)/questions?focus=99' }),
    }));
  });

  it('SKIP: settled question does nothing', async () => {
    const { sut, repo, emitter } = makeSut({
      externalId: '99', status: 'ANSWERED', product: new Types.ObjectId(), notified: true,
      save: jest.fn(),
    });
    await sut.ingest('99', 'reconcile');
    expect(repo.create).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('threads accountId into getQuestionById (multi-conta)', async () => {
    const { sut, adapter } = makeSut(null);
    await sut.ingest('99', 'reconcile', 'ACC_B');
    expect(adapter.getQuestionById).toHaveBeenCalledWith('99', 'ACC_B');
  });

  it('passes undefined accountId for the default account', async () => {
    const { sut, adapter } = makeSut(null);
    await sut.ingest('99', 'reconcile');
    expect(adapter.getQuestionById).toHaveBeenCalledWith('99', undefined);
  });
});
