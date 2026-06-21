import { WrongCategoryHandler } from './wrong-category.handler';
import { ModerationHandlerContext } from './moderation-handler.interface';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

describe('WrongCategoryHandler', () => {
  let handler: WrongCategoryHandler;
  let publisher: { requestSync: jest.Mock };
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
    const product: any = {
      _id: 'P1',
      warnings: [],
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    return {
      listing,
      product,
      state: { blockedCategoryId: 'MLB-OLD' } as any,
      canonical: {
        marketplace: 'mercadolivre',
        externalId: 'MLB123',
        type: 'WRONG_CATEGORY',
        subgroup: 'DOMAIN',
        reason: 'Categoria incorreta',
        remedy: 'Mude a categoria',
        suggestedCategories: [{ externalId: 'MLB99', name: 'Pastilhas' }],
        detectedAt: new Date('2026-06-21T10:00:00.000Z'),
      },
      ...over,
    };
  };

  beforeEach(() => {
    publisher = { requestSync: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn() };
    handler = new WrongCategoryHandler(publisher as any, events as any);
  });

  it('marks the listing pending_removal with a terminal syncIssue ONLY (no evidence in listing)', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(ctx.listing.status).toBe('pending_removal');
    expect(ctx.listing.marketplaceData.syncIssue.classifier).toBe('TERMINAL_RECREATE');
    // evidence must NOT leak into the listing blob
    expect(ctx.listing.marketplaceData.moderationReason).toBeUndefined();
    expect(ctx.listing.marketplaceData.moderationSuggestedCategories).toBeUndefined();
    expect(ctx.listing.save).toHaveBeenCalled();
  });

  it('drops the product category and pushes a single warning', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(ctx.product!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $unset: { category: '' },
        $push: expect.objectContaining({
          warnings: expect.objectContaining({
            type: 'WRONG_CATEGORY',
            externalId: 'MLB123',
            originalCategoryId: 'MLB-OLD',
            suggestedCategoryIds: ['MLB99'],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it('emits a sync command (detector, not executor — never calls ML API)', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(publisher.requestSync).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'P1',
        reason: 'moderation_wrong_category',
        resolutionSignal: 'category_change',
        force: true,
        targetMarketplaceIds: ['M1'],
      }),
      undefined,
    );
  });

  it('emits a moderation notification', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(events.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.REQUESTED,
      expect.objectContaining({
        aggregateType: 'moderation',
        deduplicationKey: 'moderation:wrong_category:MLB123',
      }),
    );
  });

  it('is idempotent — skips a listing already pending_removal', async () => {
    const ctx = makeCtx();
    ctx.listing.status = 'pending_removal';
    await handler.handle(ctx);

    expect(ctx.listing.save).not.toHaveBeenCalled();
    expect(publisher.requestSync).not.toHaveBeenCalled();
  });

  it('does not duplicate a warning already present for the same externalId', async () => {
    const ctx = makeCtx();
    ctx.product!.warnings = [{ type: 'WRONG_CATEGORY', externalId: 'MLB123' } as any];
    await handler.handle(ctx);

    expect(ctx.product!.updateOne).not.toHaveBeenCalled();
    // but the listing + command still happen
    expect(ctx.listing.save).toHaveBeenCalled();
    expect(publisher.requestSync).toHaveBeenCalled();
  });
});
