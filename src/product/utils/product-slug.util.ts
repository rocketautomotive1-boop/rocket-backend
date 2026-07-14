/**
 * Slug legível para SEO: nome curto (displayName, com fallback pra name) +
 * marca (brand.shortName, quando houver — termo comum de busca) + um
 * identificador estável (partNumber ou barcode) que garante unicidade sem
 * precisar de sufixo aleatório na maioria dos casos.
 */
function slugifyPart(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SlugSourceFields {
  displayName?: string | null;
  name?: string | null;
  brandShortName?: string | null;
  partNumber?: string | null;
  barcode?: string | null;
}

export function buildProductSlug(fields: SlugSourceFields): string {
  const namePart = slugifyPart(fields.displayName || fields.name);
  const brandPart = slugifyPart(fields.brandShortName);
  const idPart = slugifyPart(fields.partNumber || fields.barcode);

  const base = [namePart, brandPart, idPart].filter(Boolean).join('-');
  return base || `produto-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ShouldRegenerateSlugParams {
  currentSlug: string | undefined | null;
  name?: string | null;
  brandShortName?: string | null;
  partNumber?: string | null;
  barcode?: string | null;
  newDisplayName: string;
}

/**
 * O slug só é construído com displayName na criação (quando ele já existe
 * naquele momento). Se o produto foi criado antes do displayName ser
 * aprendido, o slug ficou preso no fallback name/partNumber — este helper
 * detecta esse caso pra permitir "promover" o slug uma única vez. Se o slug
 * já reflete um displayName (mesmo que antigo), não regenera, pra não
 * quebrar URL já indexada a cada edição de displayName.
 */
export function shouldRegenerateSlugForDisplayName(params: ShouldRegenerateSlugParams): boolean {
  if (!params.currentSlug) return false;

  const fallbackSlug = buildProductSlug({
    displayName: undefined,
    name: params.name,
    brandShortName: params.brandShortName,
    partNumber: params.partNumber,
    barcode: params.barcode,
  });

  return params.currentSlug === fallbackSlug;
}

/**
 * partNumber/barcode já são unique+sparse, então colisão de slug é rara — mas
 * dois produtos sem partNumber/barcode e mesmo nome colidiriam sem isso.
 */
export async function buildUniqueProductSlug(
  fields: SlugSourceFields,
  slugExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = buildProductSlug(fields);
  let candidate = base;
  let attempt = 1;
  while (await slugExists(candidate)) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  return candidate;
}
