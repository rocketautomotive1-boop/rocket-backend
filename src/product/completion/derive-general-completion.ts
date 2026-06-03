/**
 * Completude por seção de um produto de domínio 'general' (saúde, beleza,
 * bebidas, alimentos), derivada SOMENTE dos campos finais do produto (nunca do
 * draftData). Função PURA e testável. Itens gerais não têm part number, títulos
 * por marketplace, categoria interna nem dimensões obrigatórias — por isso a
 * completude difere da de autopeças (ProductReadinessService).
 *
 * Seções: dados (nome + marca), imagens, precoEstoque (preço > 0), fiscal (ncm).
 */
export interface GeneralCompletion {
  dados: boolean;
  imagens: boolean;
  precoEstoque: boolean;
  fiscal: boolean;
  readyToPublish: boolean;
}

export function deriveGeneralCompletion(product: any): GeneralCompletion {
  const p = product ?? {};

  const brandName = p.brand?.name ?? p.brand?.shortName;
  const dados = !!(p.name && String(p.name).trim()) && !!(brandName && String(brandName).trim());

  const imagens = Array.isArray(p.images) && p.images.length > 0;

  const priceNum = p.price != null ? Number(p.price) : NaN;
  const precoEstoque = Number.isFinite(priceNum) && priceNum > 0;

  const ncm = p.ncm ?? p.tax?.ncm;
  const fiscal = typeof ncm === 'string' && ncm.trim().length > 0;

  const readyToPublish = dados && imagens && precoEstoque && fiscal;

  return { dados, imagens, precoEstoque, fiscal, readyToPublish };
}
