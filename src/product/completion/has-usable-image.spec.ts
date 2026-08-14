import { hasUsableImage, isImageSlotUsable } from './has-usable-image';

describe('isImageSlotUsable', () => {
  it('active slot is usable', () => {
    expect(isImageSlotUsable({ status: 'active', url: 'http://i/1.png' })).toBe(true);
  });

  it('legacy slot without status is usable (direct upload, no rembg lifecycle)', () => {
    expect(isImageSlotUsable({ url: 'http://i/1.jpg' })).toBe(true);
    expect(isImageSlotUsable({ status: '', url: 'http://i/1.jpg' })).toBe(true);
  });

  it('a reserved slot still processing is NOT usable', () => {
    expect(isImageSlotUsable({ status: 'processing', slotId: 's1' })).toBe(false);
  });

  it('a slot whose rembg terminally failed is NOT usable', () => {
    expect(isImageSlotUsable({ status: 'failed', slotId: 's1' })).toBe(false);
  });
});

describe('hasUsableImage', () => {
  it('true when at least one active image exists', () => {
    expect(hasUsableImage([{ status: 'active', url: 'http://i/1.png' }])).toBe(true);
  });

  it('false for empty / non-array', () => {
    expect(hasUsableImage([])).toBe(false);
    expect(hasUsableImage(undefined)).toBe(false);
    expect(hasUsableImage(null)).toBe(false);
  });

  // The core regression: rembg failed on the ONLY image → must not count as done.
  it('false when the only slot terminally failed background removal', () => {
    expect(hasUsableImage([{ status: 'failed', slotId: 's1' }])).toBe(false);
  });

  // Premature-done guard: image still being processed is not done yet.
  it('false when the only slot is still processing', () => {
    expect(hasUsableImage([{ status: 'processing', slotId: 's1' }])).toBe(false);
  });

  it('true when a good image sits alongside a failed one', () => {
    expect(
      hasUsableImage([
        { status: 'failed', slotId: 's1' },
        { status: 'active', url: 'http://i/2.png', slotId: 's2' },
      ]),
    ).toBe(true);
  });
});
