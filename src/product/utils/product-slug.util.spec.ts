import { buildProductSlug, shouldRegenerateSlugForTitle } from './product-slug.util';

describe('buildProductSlug', () => {
  it('monta titleText + brand.shortName + partNumber', () => {
    const slug = buildProductSlug({
      titleText: 'Filtro de combustível',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
    });

    expect(slug).toBe('filtro-de-combustivel-mitsubishi-capa2936');
  });

  it('inclui subtitle depois do titleText', () => {
    const slug = buildProductSlug({
      titleText: 'Parafuso',
      subtitle: 'Dianteiro do Virabrequim',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
    });

    expect(slug).toBe('parafuso-dianteiro-do-virabrequim-mitsubishi-capa2936');
  });

  it('cai pra name quando não há titleText', () => {
    const slug = buildProductSlug({
      name: 'CAPA2936',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
    });

    expect(slug).toBe('capa2936-mitsubishi-capa2936');
  });

  it('omite a marca quando brandShortName não está presente', () => {
    const slug = buildProductSlug({
      titleText: 'Filtro de combustível',
      partNumber: 'CAPA2936',
    });

    expect(slug).toBe('filtro-de-combustivel-capa2936');
  });

  it('cai pra barcode quando não há partNumber', () => {
    const slug = buildProductSlug({
      titleText: 'Filtro de combustível',
      brandShortName: 'Mitsubishi',
      barcode: '7891234567890',
    });

    expect(slug).toBe('filtro-de-combustivel-mitsubishi-7891234567890');
  });
});

describe('shouldRegenerateSlugForTitle', () => {
  it('retorna true quando o slug atual foi construído a partir de name/partNumber (nunca promovido pro title)', () => {
    const result = shouldRegenerateSlugForTitle({
      currentSlug: 'capa2936-mitsubishi-capa2936',
      name: 'CAPA2936',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
      newTitleText: 'Filtro de combustível',
    });

    expect(result).toBe(true);
  });

  it('retorna false quando o slug atual já reflete um title anterior (não sobrescreve URL indexada)', () => {
    const result = shouldRegenerateSlugForTitle({
      currentSlug: 'filtro-de-oleo-mitsubishi-capa2936',
      name: 'CAPA2936',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
      newTitleText: 'Filtro de combustível',
    });

    expect(result).toBe(false);
  });

  it('retorna false quando não há slug atual (produto sem slug ainda, ex domain general)', () => {
    const result = shouldRegenerateSlugForTitle({
      currentSlug: undefined,
      name: 'CAPA2936',
      brandShortName: 'Mitsubishi',
      partNumber: 'CAPA2936',
      newTitleText: 'Filtro de combustível',
    });

    expect(result).toBe(false);
  });
});
