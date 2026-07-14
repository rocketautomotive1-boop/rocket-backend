import { computeDataQualityScore, generateEngineSignature } from './vehicle-normalizer.util';

describe('generateEngineSignature', () => {
  it('gera assinatura combinando displacementCc + fuelType', () => {
    expect(generateEngineSignature({ displacementCc: 1000, fuelType: 'Gasolina e álcool' })).toBe(
      '1000_gasolina e álcool',
    );
  });

  it('omite partes ausentes sem deixar underscore solto', () => {
    expect(generateEngineSignature({ displacementCc: 1800 })).toBe('1800');
    expect(generateEngineSignature({ fuelType: 'Diesel' })).toBe('diesel');
  });

  it('retorna string vazia para entrada vazia/undefined', () => {
    expect(generateEngineSignature(undefined)).toBe('');
    expect(generateEngineSignature({})).toBe('');
  });

  it('inclui displacementCc 0 no token (caso extremo, não ocorre em dado real)', () => {
    expect(generateEngineSignature({ displacementCc: 0, fuelType: 'Diesel' })).toBe('0_diesel');
  });
});

describe('computeDataQualityScore (shape achatado)', () => {
  it('pontua make/model/version/years/displacementCc/fuelType/transmission/bodyType/platform/fipe/aliases', () => {
    const score = computeDataQualityScore({
      make: 'Fiat',
      model: 'Toro',
      version: '1.8 Freedom',
      years: [2020],
      displacementCc: 1800,
      fuelType: 'Gasolina e álcool',
      transmission: ['Manual'],
      bodyType: 'pickup',
      platform: 'Fiat Mobi',
      fipe: { code: '001004-9' },
      aliases: ['fiat toro'],
    });
    // 15+15+10+12+18+10+6+4+4+4+2 = 100
    expect(score).toBe(100);
  });

  it('retorna 0 para entrada totalmente vazia', () => {
    expect(computeDataQualityScore({})).toBe(0);
  });

  it('displacementCc contribui 18 pontos, substituindo os 10+8 antigos de engine.family+engine.displacement', () => {
    const withDisplacement = computeDataQualityScore({ make: 'Fiat', displacementCc: 1000 });
    const withoutDisplacement = computeDataQualityScore({ make: 'Fiat' });
    expect(withDisplacement - withoutDisplacement).toBe(18);
  });
});
