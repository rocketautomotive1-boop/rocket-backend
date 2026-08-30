import { WrongCategoryHandler } from './wrong-category.handler';
import { ModerationHandlerContext } from './moderation-handler.interface';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import { PRODUCT_SECTION_EVENTS } from '../../product/events/product-section-saved.event';

describe('WrongCategoryHandler', () => {
  let handler: WrongCategoryHandler;
  let events: { emit: jest.Mock };
  let titleCategoryHintService: { invalidateHint: jest.Mock };

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
      titleId: 'T1',
      category: 'CAT-OLD',
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
    events = { emit: jest.fn() };
    titleCategoryHintService = { invalidateHint: jest.fn().mockResolvedValue(undefined) };
    handler = new WrongCategoryHandler(events as any, titleCategoryHintService as any);
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

  it('does NOT re-publish (ML blocks editing a wrong-category listing; republish waits for user fix)', async () => {
    const ctx = makeCtx();
    // handler no longer takes a publisher; assert via the events-only constructor + no extra calls
    await handler.handle(ctx);

    // Outward signals: a notification (user-facing) + CATEGORY_SAVED (invalidates the
    // readyToPublish marker so a later category fix can re-trigger BECAME_READY). Neither
    // is a sync/publish command — no direct republish happens here.
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.anything());
    expect(events.emit).toHaveBeenCalledWith(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED, expect.anything());
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
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('regressão: emite CATEGORY_SAVED após dropar a categoria, pra invalidar o readyToPublish obsoleto (senão o produto nunca reenfileira quando o usuário corrigir a categoria — BECAME_READY só dispara na borda false→true, e o campo persistido fica travado em true)', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(events.emit).toHaveBeenCalledWith(
      PRODUCT_SECTION_EVENTS.CATEGORY_SAVED,
      expect.objectContaining({ productId: 'P1' }),
    );
  });

  it('não emite CATEGORY_SAVED quando idempotente (listing já pending_removal — categoria não foi tocada)', async () => {
    const ctx = makeCtx();
    ctx.listing.status = 'pending_removal';
    await handler.handle(ctx);

    expect(events.emit).not.toHaveBeenCalledWith(
      PRODUCT_SECTION_EVENTS.CATEGORY_SAVED,
      expect.anything(),
    );
  });

  it('does not duplicate a warning already present for the same externalId', async () => {
    const ctx = makeCtx();
    ctx.product!.warnings = [{ type: 'WRONG_CATEGORY', externalId: 'MLB123' } as any];
    await handler.handle(ctx);

    expect(ctx.product!.updateOne).not.toHaveBeenCalled();
    // but the listing block + notification still happen
    expect(ctx.listing.save).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalled();
  });

  it('invalidates the titleId->category hint so the auto-resolve does not repeat the ML-rejected category', async () => {
    const ctx = makeCtx();
    await handler.handle(ctx);

    expect(titleCategoryHintService.invalidateHint).toHaveBeenCalledWith('T1', 'CAT-OLD');
  });

  it('does not invalidate a hint when the product has no titleId or no prior category', async () => {
    const ctx = makeCtx();
    ctx.product!.titleId = undefined;
    await handler.handle(ctx);

    expect(titleCategoryHintService.invalidateHint).not.toHaveBeenCalled();
  });

  it('does not invalidate a hint when the listing is already pending_removal (idempotent skip)', async () => {
    const ctx = makeCtx();
    ctx.listing.status = 'pending_removal';
    await handler.handle(ctx);

    expect(titleCategoryHintService.invalidateHint).not.toHaveBeenCalled();
  });
});
