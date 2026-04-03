/**
 * Chaves de deduplicação de discovery (alinhadas à construção de `query` em startDiscovery).
 * Documentos antigos sem partNumberNorm/brandNorm não participam do dedup até backfill.
 *
 * - isGenuine true: só partNumber (brand ignorado); brandNorm fica ''.
 * - Caso contrário: partNumberNorm + brandNorm (nome em minúsculas).
 */
export function normalizePartNumberForDedup(partNumber: string): string {
    return (partNumber || '').trim().toUpperCase();
}

export function normalizeBrandForDedup(brand: string | undefined, isGenuine: boolean): string {
    if (isGenuine) return '';
    return (brand || '').trim().toLowerCase();
}

export function computeDiscoveryDedupFields(args: {
    partNumber: string;
    brand?: string;
    isGenuine?: boolean;
}): { partNumberNorm: string; brandNorm: string; isGenuine: boolean } {
    const genuine = !!args.isGenuine;
    return {
        partNumberNorm: normalizePartNumberForDedup(args.partNumber),
        brandNorm: normalizeBrandForDedup(args.brand, genuine),
        isGenuine: genuine,
    };
}
