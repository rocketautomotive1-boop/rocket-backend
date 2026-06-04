import { Injectable } from '@nestjs/common';
import { ProductDocument } from '../../product/product-types';

/** Snapshot da última entrada de estoque (condição/situação reais do lote). */
export type ListingStockSnapshot = { condition: string; situation: string };

/**
 * Responsabilidade única: converter um ProductDocument em um mapa flat de
 * placeholder → valor string, pronto para substituição no template.
 *
 * Para adicionar um novo placeholder:
 *   1. Adicione uma chave no objeto retornado por `map()`
 *   2. Use o novo placeholder no template: {nome_chave}
 *   Nenhum outro arquivo precisa ser alterado.
 */
@Injectable()
export class ProductFieldMapper {
  map(product: ProductDocument, stockSnapshot?: ListingStockSnapshot | null): Record<string, string> {
    const p = product as any;
    const rocketAttrs = this.getRocketAttributes(p);

    const condicaoLabel = stockSnapshot
      ? this.conditionCodeToPortugueseLabel(stockSnapshot.condition)
      : this.resolveProductConditionLabel(p);

    return {
      produto:         this.formatProductName(product.name, product.partNumber),
      marca:           product.brand?.amazonName || product.brand?.name || this.resolveBrandFromAttributes(p),
      modelo:          product.partNumber || '',
      descricao:       product.description || '',
      descricao_curta: product.description || '',
      detalhes:        p.details || '',
      condicao:        condicaoLabel,
      preco:           product.price ? Number(product.price).toFixed(2) : '0.00',
      codigo:          product.barcode || product.partNumber || '',
      peso:            product.weight ? String(product.weight) : '0',
      comprimento:     product.dimensions?.length ? String(product.dimensions.length) : '0',
      largura:         product.dimensions?.width  ? String(product.dimensions.width)  : '0',
      altura:          product.dimensions?.height ? String(product.dimensions.height) : '0',
      categoria:       (product.category as any)?.name || '',
      observacao:      p.observation || p.obs || '',
      garantia:        '',

      // Atributos internos (Rocket) — especificações técnicas do produto
      atributos:        this.formatAttributesList(rocketAttrs),
      atributos_tabela: this.formatAttributesTable(rocketAttrs),
      atributos_count:  String(rocketAttrs.length),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private conditionCodeToPortugueseLabel(code: string): string {
    const c = String(code || '').toLowerCase();
    if (c === 'used') return 'Usado';
    if (c === 'refurbished' || c === 'remanufactured') return 'Recondicionado';
    return 'Novo';
  }

  /** Fallback quando não há movimentação de entrada (ex.: só saídas ou estoque legado). */
  private resolveProductConditionLabel(p: any): string {
    if (p.condition?.name) return p.condition.name;
    if (p.conditionName) return p.conditionName;
    const raw = String(p.condition || 'new').toLowerCase();
    if (raw === 'used') return 'Usado';
    if (raw === 'refurbished' || raw === 'remanufactured') return 'Recondicionado';
    return 'Novo';
  }

  private formatProductName(name: string, partNumber: string): string {
    const capitalized = this.capitalize(name || '');
    if (!partNumber || capitalized.toUpperCase().includes(partNumber.toUpperCase())) return capitalized;
    const withPart = `${capitalized} ${partNumber}`.trim();
    return withPart.length <= 60 ? withPart : capitalized;
  }

  private capitalize(text: string): string {
    if (!text) return '';
    return text
      .split(' ')
      .map(word => {
        if (word.length <= 2) return word;
        if (word[0] === word[0].toUpperCase()) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  /**
   * Fallback de marca a partir dos atributos quando não há `product.brand`.
   * No domínio general a marca vive como atributo BRAND (de marketplace), não
   * no relacionamento brand do produto.
   */
  private resolveBrandFromAttributes(product: any): string {
    const attrs = product?.attributes;
    if (!Array.isArray(attrs)) return '';
    const brand = attrs.find((a: any) => (a.code || a.id) === 'BRAND' && a.value);
    return brand ? String(brand.valueName || brand.value) : '';
  }

  /**
   * Extrai atributos internos (Rocket) do produto.
   * Filtra attributes de marketplace específico (ML, Shopee, etc.) que possuem `code`.
   * Rocket attributes são customizados pelo usuário e não têm code.
   */
  private getRocketAttributes(product: any): Array<{ name: string; value: string }> {
    if (!product.attributes?.length) return [];
    return product.attributes
      .filter((a: any) => a.name && a.value && !a.marketplaceId)
      .map((a: any) => ({ name: a.name, value: a.valueName || String(a.value) }));
  }

  /** Formato lista simples: "Nome: Valor" por linha */
  private formatAttributesList(attrs: Array<{ name: string; value: string }>): string {
    if (!attrs.length) return '';
    return attrs.map(a => `${a.name}: ${a.value}`).join('\n');
  }

  /** Formato tabela com separador visual */
  private formatAttributesTable(attrs: Array<{ name: string; value: string }>): string {
    if (!attrs.length) return '';
    const maxLen = Math.min(Math.max(...attrs.map(a => a.name.length)), 25);
    return attrs.map(a => `${a.name.padEnd(maxLen)}  │  ${a.value}`).join('\n');
  }
}
