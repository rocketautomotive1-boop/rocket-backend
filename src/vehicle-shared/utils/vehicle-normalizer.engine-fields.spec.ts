import { normalizeDisplacementCc, normalizeFuelTags } from './vehicle-normalizer.util';

describe('normalizeDisplacementCc', () => {
  it('extrai cc direto de "1000 cc"', () => {
    expect(normalizeDisplacementCc('1000 cc')).toBe(1000);
  });

  it('extrai cc de "1400 cc"', () => {
    expect(normalizeDisplacementCc('1400 cc')).toBe(1400);
  });

  it('converte litros decimais com ponto: "1.0" -> 1000', () => {
    expect(normalizeDisplacementCc('1.0')).toBe(1000);
  });

  it('converte litros decimais com vírgula: "1,4" -> 1400', () => {
    expect(normalizeDisplacementCc('1,4')).toBe(1400);
  });

  it('extrai cc de "2000cc" sem espaço', () => {
    expect(normalizeDisplacementCc('2000cc')).toBe(2000);
  });

  it('retorna undefined para entrada vazia', () => {
    expect(normalizeDisplacementCc('')).toBeUndefined();
    expect(normalizeDisplacementCc(undefined)).toBeUndefined();
  });

  it('retorna undefined para texto irreconhecível', () => {
    expect(normalizeDisplacementCc('motor V8')).toBeUndefined();
  });
});

describe('normalizeFuelTags', () => {
  it('mapeia "Diesel" -> ["diesel"]', () => {
    expect(normalizeFuelTags('Diesel')).toEqual(['diesel']);
  });

  it('mapeia "Gasolina e álcool" -> gasoline + ethanol', () => {
    expect(normalizeFuelTags('Gasolina e álcool').sort()).toEqual(['ethanol', 'gasoline']);
  });

  it('mapeia "Híbrido/Flex" -> hybrid + gasoline + ethanol (flex nunca é gravado como tag literal)', () => {
    expect(normalizeFuelTags('Híbrido/Flex').sort()).toEqual(['ethanol', 'gasoline', 'hybrid']);
  });

  it('mapeia "Tetra-combustible" -> [] (não reconhecido)', () => {
    expect(normalizeFuelTags('Tetra-combustible')).toEqual([]);
  });

  it('mapeia "Gasolina-Álcool e gás natural" -> gasoline + ethanol + cng', () => {
    expect(normalizeFuelTags('Gasolina-Álcool e gás natural').sort()).toEqual([
      'cng',
      'ethanol',
      'gasoline',
    ]);
  });

  it('retorna [] para entrada vazia', () => {
    expect(normalizeFuelTags('')).toEqual([]);
    expect(normalizeFuelTags(undefined)).toEqual([]);
  });
});
