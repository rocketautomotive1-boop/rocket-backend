import { DiscoveryAppData, DiscoveryVehicleSuggestion } from './discovery-app.dto';

/**
 * Single source of truth for the discovery wire shape.
 *
 * Every transport (REST `getByProduct`, WS live `queue.job.update`, WS catch-up)
 * MUST run the persisted/synthesized discovery document through this mapper so the
 * frontend always receives exactly one contract: {@link DiscoveryAppData}.
 *
 * The input `doc` is the raw Mongo document (or an equivalent `{ final, sources,
 * resolvedCategoryId, query }` envelope assembled at emit time). `final` is the
 * authoritative synthesized payload produced by `discovery-ms-response.consumer`;
 * the legacy flat `data` field is only consulted for documents predating `final`.
 */
export function mapDiscoveryDocToAppData(doc: any): DiscoveryAppData {
    const finalPayload = (doc?.final && typeof doc.final === 'object') ? doc.final : (doc?.data ?? {});
    const sources = (doc?.sources && typeof doc.sources === 'object') ? doc.sources : {};
    const mlSource = (sources?.mercadolivre && typeof sources.mercadolivre === 'object') ? sources.mercadolivre : {};
    const serpSource = (sources?.serp && typeof sources.serp === 'object') ? sources.serp : {};
    const menorPreco = (sources?.menorPreco && typeof sources.menorPreco === 'object')
        ? {
            stats: sources.menorPreco.stats ?? null,
            offers: Array.isArray(sources.menorPreco.offers) ? sources.menorPreco.offers : [],
            confidence: sources.menorPreco.confidence,
          }
        : null;

    const rawVehicles = Array.isArray(finalPayload?.vehicles) ? finalPayload.vehicles : [];
    const vehicles: DiscoveryVehicleSuggestion[] = rawVehicles
        .map((v: any) => {
            if (typeof v === 'string') return { label: v.trim() };
            if (v && typeof v === 'object') {
                const label = v.label ?? [v.brand, v.model].filter(Boolean).join(' ').trim();
                if (label) return { label };
            }
            return null;
        })
        .filter((v: DiscoveryVehicleSuggestion | null): v is DiscoveryVehicleSuggestion => !!v && !!v.label);

    const breadcrumbPath = String(finalPayload?.breadcrumb ?? finalPayload?.breadcrumbPath ?? finalPayload?.breadCrumbPath ?? '');
    const categoryPath = finalPayload?.categoryPath ?? (breadcrumbPath || null);

    const rawAttributes = Array.isArray(finalPayload?.attributes) ? finalPayload.attributes : [];
    const attributes = rawAttributes
        .map((a: any) => ({
            id: typeof a?.id === 'string' ? a.id : undefined,
            key: String(a?.key ?? a?.name ?? '').trim(),
            value: String(a?.value ?? a?.value_name ?? '').trim(),
        }))
        .filter((a: { key: string; value: string }) => !!a.key && !!a.value);

    return {
        titles: Array.isArray(finalPayload?.titles) ? finalPayload.titles : [],
        prices: finalPayload?.prices ?? null,
        description: String(finalPayload?.description ?? ''),
        details: String(finalPayload?.details ?? ''),
        attributes,
        oemCodes: Array.isArray(finalPayload?.oemCodes) ? finalPayload.oemCodes : [],
        vehicles,
        categoryPath: categoryPath ? String(categoryPath) : null,
        breadcrumbPath,
        suggestedImages: Array.isArray(finalPayload?.suggestedImages) ? finalPayload.suggestedImages : [],
        winningSource: finalPayload?.preferredSource === 'mercadolivre' || finalPayload?.preferredSource === 'serp'
            ? finalPayload.preferredSource
            : null,
        confidence: finalPayload?.confidence ? String(finalPayload.confidence) : null,
        partNumber: String(finalPayload?.partNumber ?? doc?.partNumberNorm ?? doc?.query ?? ''),
        rawItems: Array.isArray(mlSource?.items)
            ? mlSource.items
            : (Array.isArray(serpSource?.items) ? serpSource.items : []),
        resolvedCategoryId: doc?.resolvedCategoryId ? String(doc.resolvedCategoryId) : null,
        timing: finalPayload?.timing ?? null,
        menorPreco,
    };
}
