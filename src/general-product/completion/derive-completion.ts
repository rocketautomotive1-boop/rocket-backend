/**
 * Completude por seção do dashboard de itens gerais, derivada SOMENTE dos
 * campos finais do produto (nunca do draftData). Função pura e testável —
 * espelha o padrão deriveSectionView do frontend. O repositório sanitiza
 * Decimal128 → string, então `price` pode chegar como string ou number.
 */
export interface GeneralCompletion {
  dados: boolean;
  imagens: boolean;
  precoEstoque: boolean;
  fiscal: boolean;
}

export function deriveCompletion(product: any): GeneralCompletion {
  const p = product ?? {};

  const dados = !!(p.name && String(p.name).trim()) && !!(p.brand?.name && String(p.brand.name).trim());

  const imagens = Array.isArray(p.images) && p.images.length > 0;

  const priceNum = p.price != null ? Number(p.price) : NaN;
  const precoEstoque = Number.isFinite(priceNum) && priceNum > 0;

  const fiscal = typeof p.ncm === 'string' && p.ncm.trim().length > 0;

  return { dados, imagens, precoEstoque, fiscal };
}
