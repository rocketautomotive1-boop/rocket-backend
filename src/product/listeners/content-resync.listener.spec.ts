import { ContentResyncListener } from './content-resync.listener';
import { ProductImagesSavedEvent } from '../events/product-section-saved.event';

/**
 * Proves the auto re-sync gate for CONTENT edits on an already-published product:
 *  - debounces a burst of section saves into a single sync
 *  - only syncs when the product is BOTH already published AND ready (never mid-rembg)
 *  - never syncs an unpublished product (first publish is owned by BECAME_READY)
 */
function makeSut(opts: { published: boolean; readyToPublish: boolean }) {
  const orchestratorPublisher = { requestSync: jest.fn().mockResolvedValue(undefined) };
  const listingService = { existsActiveForProduct: jest.fn().mockResolvedValue(opts.published) };
  const readiness = { compute: jest.fn().mockResolvedValue({ readyToPublish: opts.readyToPublish }) };
  const sut = new ContentResyncListener(
    orchestratorPublisher as any,
    listingService as any,
    readiness as any,
  );
  return { sut, orchestratorPublisher, listingService, readiness };
}

/** Run pending debounce timers and let the async maybeResync microtasks settle. */
async function flushDebounce() {
  jest.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ContentResyncListener', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('re-syncs a published + ready product after the debounce window', async () => {
    const { sut, orchestratorPublisher } = makeSut({ published: true, readyToPublish: true });

    sut.onImages(new ProductImagesSavedEvent('p1'));
    await flushDebounce();

    expect(orchestratorPublisher.requestSync).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', reason: 'content_edit' }),
    );
  });

  it('coalesces a burst of section saves into a single sync (debounce)', async () => {
    const { sut, orchestratorPublisher } = makeSut({ published: true, readyToPublish: true });

    sut.onImages(new ProductImagesSavedEvent('p1'));
    sut.onImages(new ProductImagesSavedEvent('p1'));
    sut.onImages(new ProductImagesSavedEvent('p1'));
    await flushDebounce();

    expect(orchestratorPublisher.requestSync).toHaveBeenCalledTimes(1);
  });

  it('does NOT sync an unpublished product (first publish is owned by BECAME_READY)', async () => {
    const { sut, orchestratorPublisher, readiness } = makeSut({ published: false, readyToPublish: true });

    sut.onImages(new ProductImagesSavedEvent('p1'));
    await flushDebounce();

    expect(orchestratorPublisher.requestSync).not.toHaveBeenCalled();
    // Short-circuits before computing readiness.
    expect(readiness.compute).not.toHaveBeenCalled();
  });

  it('does NOT sync while an image slot is still processing (product not ready)', async () => {
    const { sut, orchestratorPublisher } = makeSut({ published: true, readyToPublish: false });

    sut.onImages(new ProductImagesSavedEvent('p1'));
    await flushDebounce();

    expect(orchestratorPublisher.requestSync).not.toHaveBeenCalled();
  });
});
