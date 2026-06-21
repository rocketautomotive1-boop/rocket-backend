import { MissingCompatibilityHandler } from './missing-compatibility.handler';
import { ModerationHandlerContext } from './moderation-handler.interface';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

describe('MissingCompatibilityHandler', () => {
  let handler: MissingCompatibilityHandler;
  let events: { emit: jest.Mock };

  const makeCtx = (over: Partial<ModerationHandlerContext> = {}): ModerationHandlerContext => {
    const listing: any = {
      _id: 'L1',
      productId: 'P1',
      marketplaceId: 'M1',
      externalId: 'MLB123',
      status: 'active',
      marketplaceData: {},
      save: jest.fn().mockResolvedValue(undefined),
    };
    return {
      listing,
      product: null,
      state: {} as any,
      canonical: {
        marketplace: 'mercadolivre',
        externalId: 'MLB123',
        type: 'MISSING_COMPATIBILITIES',
        subgroup: 'COMPATS',
        reason: 'Sem compatibilidades',
        remedy: 'Adicione veículos',
        detectedAt: new Date('2026-06-21T10:00:00.000Z'),
      },
      ...over,
    };
  };

  beforeEach(() => {
    events = { emit: jest.fn() };
    handler = new MissingCompatibilityHandler(events as any);
  });

  it('flags a retryable missing_compatibilities syncIssue (evidence stays out of the listing)', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(ctx.listing.status).toBe('error');
    expect(ctx.listing.marketplaceData.syncIssue.classifier).toBe('MISSING_COMPATIBILITIES');
    expect(ctx.listing.marketplaceData.syncIssue.retryable).toBe(true);
    expect(ctx.listing.marketplaceData.compatibilityModerationReason).toBeUndefined();
    expect(ctx.listing.save).toHaveBeenCalled();
  });

  it('does not override a TERMINAL_RECREATE listing', async () => {
    const ctx = makeCtx();
    ctx.listing.marketplaceData = { syncIssue: { classifier: 'TERMINAL_RECREATE' } };
    await handler.handle(ctx);

    expect(ctx.listing.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('emits a moderation notification', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(events.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.REQUESTED,
      expect.objectContaining({
        aggregateType: 'moderation',
        deduplicationKey: 'moderation:missing_compat:MLB123',
      }),
    );
  });
});
