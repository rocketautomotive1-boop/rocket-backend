export interface ProductPromptContext {
  partNumber?: string;
  barcode?: string;
  description?: string;
  details?: string;
  brand?: { name?: string } | null;
  productTitles?: Array<{ title?: string }>;
  attributes?: Array<{ name?: string; value?: string }>;
}

/**
 * Monta o prompt final para geração de imagem, enriquecendo a instrução do
 * usuário com o contexto do produto. Função pura, sem I/O. Campos ausentes são
 * omitidos (nunca emite "N/A"/"undefined").
 */
export function buildImagePrompt(product: ProductPromptContext, instruction: string): string {
  const lines: string[] = [];

  const title = product.productTitles?.find((t) => t?.title)?.title;
  if (title) lines.push(`Produto: ${title}`);
  if (product.partNumber) lines.push(`Código (part number): ${product.partNumber}`);
  if (product.barcode) lines.push(`EAN/Código de barras: ${product.barcode}`);
  if (product.brand?.name) lines.push(`Marca: ${product.brand.name}`);
  if (product.description) lines.push(`Descrição: ${product.description}`);
  if (product.details) lines.push(`Detalhes técnicos: ${product.details}`);

  const attrs = (product.attributes ?? [])
    .filter((a) => a?.name && a?.value)
    .map((a) => `- ${a.name}: ${a.value}`);
  if (attrs.length > 0) lines.push(`Atributos:\n${attrs.join('\n')}`);

  const context = lines.join('\n');
  const userInstruction = instruction?.trim();

  return [
    'Gere uma imagem de produto profissional para e-commerce de autopeças.',
    userInstruction ? `Instrução: ${userInstruction}` : 'Instrução: foto de catálogo, fundo branco, boa iluminação.',
    context ? `\nContexto do produto:\n${context}` : '',
    '\nA imagem deve ser fiel ao produto descrito, nítida e adequada para anúncio.',
  ]
    .filter(Boolean)
    .join('\n');
}
