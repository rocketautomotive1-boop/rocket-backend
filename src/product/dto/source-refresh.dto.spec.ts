import { parseSourceName } from './source-refresh.dto';

describe('parseSourceName', () => {
  it('aceita fontes válidas', () => {
    expect(parseSourceName('menorPreco')).toBe('menorPreco');
    expect(parseSourceName('ml')).toBe('ml');
    expect(parseSourceName('serp')).toBe('serp');
  });

  it('rejeita fonte inválida com mensagem em PT', () => {
    expect(() => parseSourceName('amazon')).toThrow(/Fonte inválida/);
  });
});
