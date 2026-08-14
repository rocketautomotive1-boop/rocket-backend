/**
 * Single source of truth for "does this product have at least one image that is
 * actually usable for publication?".
 *
 * A product image slot carries a `status`: 'active' | 'processing' | 'failed'.
 * When background removal (rembg) is requested, a slot is RESERVED in
 * `product.images` before the microservice runs — it starts as 'processing' and
 * becomes 'active' on success or 'failed' after the retries are exhausted.
 *
 * Counting the raw array length (`images.length > 0`) treats a reserved slot that
 * is still processing — or one whose background removal terminally failed — as a
 * completed image. That is the bug where "Imagens" shows done even though rembg
 * failed and there is no usable picture. Completion must count ONLY slots that
 * resolved to a usable image:
 *   - status === 'active'  → ready
 *   - status absent/empty  → legacy/direct upload with no rembg lifecycle → ready
 *   - status === 'processing' | 'failed' → NOT usable, excluded
 */
export function isImageSlotUsable(img: any): boolean {
  const status = img?.status;
  return status === 'active' || status == null || status === '';
}

export function hasUsableImage(images: unknown): boolean {
  return Array.isArray(images) && images.some(isImageSlotUsable);
}
