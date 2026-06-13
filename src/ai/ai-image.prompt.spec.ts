import { buildImagePrompt, ProductPromptContext } from './ai-image.prompt';

const fullProduct: ProductPromptContext = {
  partNumber: 'BTC08206',
  barcode: '7891234567890',
  description: 'Amortecedor dianteiro pressurizado',
  details: 'Curso 180mm, rosca M12',
  brand: { name: 'Cofap' },
  productTitles: [{ title: 'Amortecedor Dianteiro Cofap BTC08206' }],
  attributes: [
    { name: 'Posição', value: 'Dianteira' },
    { name: 'Lado', value: 'Direito' },
  ],
};

describe('buildImagePrompt', () => {
  it('injeta EAN, título, descrição, marca e atributos no prompt', () => {
    const prompt = buildImagePrompt(fullProduct, 'foto em fundo branco, vista 3/4');
    expect(prompt).toContain('foto em fundo branco, vista 3/4');
    expect(prompt).toContain('7891234567890');
    expect(prompt).toContain('Amortecedor Dianteiro Cofap BTC08206');
    expect(prompt).toContain('Amortecedor dianteiro pressurizado');
    expect(prompt).toContain('Cofap');
    expect(prompt).toContain('Posição: Dianteira');
  });

  it('produz prompt válido mesmo com instrução vazia', () => {
    const prompt = buildImagePrompt(fullProduct, '');
    expect(prompt.trim().length).toBeGreaterThan(0);
    expect(prompt).toContain('Cofap');
  });

  it('omite campos ausentes sem deixar "N/A" no prompt', () => {
    const prompt = buildImagePrompt(
      { partNumber: 'X1', productTitles: [], attributes: [] },
      'gerar imagem',
    );
    expect(prompt).not.toContain('N/A');
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('X1');
  });
});
