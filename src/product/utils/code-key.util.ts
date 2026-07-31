/**
 * Canonical normalization for auto-parts codes (Product.partNumber and
 * cross-reference codes), shared by both domains so a code registered by
 * one matches a search/merge attempt from the other regardless of source
 * formatting (e.g. "N-99150", "N99150", "N 99150" all key to "N99150").
 *
 * Strips hyphens, dots and whitespace: these carry no manufacturer meaning
 * in practice — they're free-form punctuation that varies per source
 * catalog for what is otherwise the same code.
 */
export function normalizeCode(raw: string): string {
    return (raw || '').trim().toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Canonical normalization for cross-reference brand names — different source
 * catalogs spell the same brand with different casing (e.g. "TRW" vs "Trw",
 * verified 212 such pairs across the current catalog set). These are mostly
 * NOT brands registered in the `brands` collection (many are competitor/OEM
 * names cited only as a reference, like "Nissan" or "Hipper Freios", never
 * onboarded as a Rocket brand) — a foreign key isn't the right fix here, just
 * consistent string comparison. Only uppercases/trims, unlike normalizeCode:
 * brand names carry meaningful internal spaces/hyphens (e.g. "Alfa Romeo",
 * "Mercedes-Benz") that codes don't.
 */
export function normalizeBrand(raw: string): string {
    return (raw || '').trim().toUpperCase();
}

/**
 * Brand labels used by legacy/malformed source catalogs to cite an
 * equivalent code without identifying its real manufacturer (e.g. Spaal's
 * "SIMILAR", "DIVERSOS" — see catalog-spaal-imported memory). Not a real
 * brand — a `cross_reference_codes` row under one of these is a weaker
 * claim than the same codeKey under a named brand in the same group.
 *
 * Maintained by hand: grows only when a new legacy catalog is found to use
 * another placeholder label. Deliberately NOT runtime config — this is
 * catalog data-quality knowledge, not a business rule of normal ingestion.
 * Already normalizeBrand()-ed (trim+uppercase) for direct comparison.
 */
export const GHOST_BRANDS: ReadonlySet<string> = new Set(['SIMILAR', 'DIVERSOS']);

export function isGhostBrand(brandKey: string): boolean {
    return GHOST_BRANDS.has(brandKey);
}

/** Escapes regex metacharacters in user-supplied search text before it's
 *  interpolated into a Mongo $regex — search input is never trusted as a
 *  literal regex (e.g. a bare "(" would otherwise throw). */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
