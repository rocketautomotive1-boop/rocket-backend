/**
 * Completude por seção de um produto de domínio 'general'. Função PURA e testável.
 * O preço NÃO vem de product.price (removido pelo pricing refactor) — é o preço
 * efetivo do PricingModule, passado em opts.effectivePrice pelo caller.
 *
 * Seções: dados (nome + marca), imagens, precoEstoque (effectivePrice > 0), fiscal (ncm).
 */
import { hasUsableImage } from './has-usable-image';

export interface GeneralCompletion {
  dados: boolean;
  imagens: boolean;
  precoEstoque: boolean;
  fiscal: boolean;
  readyToPublish: boolean;
}

export interface GeneralCompletionOpts {
  effectivePrice?: number | null;
}

export function deriveGeneralCompletion(product: any, opts: GeneralCompletionOpts = {}): GeneralCompletion {
  const p = product ?? {};

  const brandName = p.brand?.name ?? p.brand?.shortName;
  const dados = !!(p.name && String(p.name).trim()) && !!(brandName && String(brandName).trim());

  // Slots still processing rembg or whose background removal failed are not usable.
  const imagens = hasUsableImage(p.images);

  const priceNum = opts.effectivePrice != null ? Number(opts.effectivePrice) : NaN;
  const precoEstoque = Number.isFinite(priceNum) && priceNum > 0;

  const ncm = p.ncm ?? p.tax?.ncm;
  const fiscal = typeof ncm === 'string' && ncm.trim().length > 0;

  const readyToPublish = dados && imagens && precoEstoque && fiscal;

  return { dados, imagens, precoEstoque, fiscal, readyToPublish };
}
