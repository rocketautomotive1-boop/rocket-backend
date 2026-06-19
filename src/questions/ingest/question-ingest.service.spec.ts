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
  const auth = { ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'tok' }) };
  const broker = {
    ensureValidTokenByAccount: jest.fn().mockResolvedValue({ accessToken: 'tok-acc', additionalData: {} }),
  };
  const adapter = {
    getQuestionById: jest.fn().mockResolvedValue({
      id: 99, item_id: 'MLB1', text: 'oi?', status: 'UNANSWERED',
      date_created: new Date().toISOString(), from: { id: 1, nickname: 'b' },
    }),
  };
  const resolver = { resolve: jest.fn().mockResolvedValue(new Types.ObjectId()) };
  const emitter = { emit: jest.fn() };
  const sut = new QuestionIngestService(
    repo as any, registry as any, auth as any, broker as any, adapter as any, resolver as any, emitter as any,
  );
  return { sut, repo, emitter, resolver, auth, broker, adapter };
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

  it('SKIP: settled question does nothing', async () => {
    const { sut, repo, emitter } = makeSut({
      externalId: '99', status: 'ANSWERED', product: new Types.ObjectId(), notified: true,
      save: jest.fn(),
    });
    await sut.ingest('99', 'reconcile');
    expect(repo.create).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('resolves the token by account when accountId is given', async () => {
    const { sut, broker, auth, adapter } = makeSut(null) as any;
    await sut.ingest('99', 'reconcile', 'ACC_B');
    expect(broker.ensureValidTokenByAccount).toHaveBeenCalledWith(
      String(mlMarketplace._id),
      'ACC_B',
    );
    expect(auth.ensureValidToken).not.toHaveBeenCalled();
    expect(adapter.getQuestionById).toHaveBeenCalledWith('tok-acc', '99');
  });

  it('falls back to default account token when no accountId', async () => {
    const { sut, broker, auth } = makeSut(null) as any;
    await sut.ingest('99', 'reconcile');
    expect(auth.ensureValidToken).toHaveBeenCalled();
    expect(broker.ensureValidTokenByAccount).not.toHaveBeenCalled();
  });
});
