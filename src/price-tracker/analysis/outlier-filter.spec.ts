import { filterOutliers, OUTLIER_MAX_PCT, OUTLIER_MIN_PCT, recomputeStats } from './outlier-filter';

const offer = (price: number) => ({ price, sellerName: `Vendedor ${price}` });

describe('filterOutliers', () => {
  it('sem movingAvg (item novo) → nenhuma oferta é suspeita, filtro inativo', () => {
    const offers = [offer(3), offer(36), offer(1000)];
    const result = filterOutliers(offers, null);
    expect(result.every((o) => !o.suspicious)).toBe(true);
  });

  it('oferta dentro da faixa → não suspeita', () => {
    const [result] = filterOutliers([offer(30)], 36); // 83% da média, dentro de [20%, 600%]
    expect(result.suspicious).toBe(false);
  });

  it('oferta abaixo de OUTLIER_MIN_PCT → suspeita (caso do fardo fracionado)', () => {
    // movingAvg=36 (fardo fechado), oferta=3 (≈8% da média — 1 unidade de um fardo de 12)
    const [result] = filterOutliers([offer(3)], 36);
    expect(result.suspicious).toBe(true);
  });

  it('oferta acima de OUTLIER_MAX_PCT → suspeita (erro de digitação, ex: dígito a mais)', () => {
    const [result] = filterOutliers([offer(300)], 36); // ~833% da média
    expect(result.suspicious).toBe(true);
  });

  it('oferta exatamente no limite inferior → não suspeita (comparação estrita)', () => {
    const movingAvg = 36;
    const limit = movingAvg * OUTLIER_MIN_PCT;
    const [result] = filterOutliers([offer(limit)], movingAvg);
    expect(result.suspicious).toBe(false);
  });

  it('oferta exatamente no limite superior → não suspeita (comparação estrita)', () => {
    const movingAvg = 36;
    const limit = movingAvg * OUTLIER_MAX_PCT;
    const [result] = filterOutliers([offer(limit)], movingAvg);
    expect(result.suspicious).toBe(false);
  });

  it('preserva todas as ofertas na lista (não remove, só marca suspicious)', () => {
    const offers = [offer(3), offer(30), offer(300)];
    const result = filterOutliers(offers, 36);
    expect(result).toHaveLength(3);
    expect(result.map((o) => o.suspicious)).toEqual([true, false, true]);
  });

  it('oferta sem price (null) → não suspeita (nada a avaliar)', () => {
    const [result] = filterOutliers([{ price: null, sellerName: 'X' }], 36);
    expect(result.suspicious).toBe(false);
  });
});

describe('recomputeStats', () => {
  it('ignora ofertas suspeitas no cálculo de median/avg/count', () => {
    const flagged = filterOutliers([offer(3), offer(30), offer(40), offer(300)], 36);
    // válidas: 30, 40 → median = 35, avg = 35, count = 2 (3 e 300 são suspeitas, fora)
    const stats = recomputeStats(flagged);
    expect(stats).toEqual({ median: 35, avg: 35, count: 2 });
  });

  it('nenhuma oferta suspeita (filtro inativo) → usa todas', () => {
    const flagged = filterOutliers([offer(10), offer(20), offer(30)], null);
    const stats = recomputeStats(flagged);
    expect(stats).toEqual({ median: 20, avg: 20, count: 3 });
  });

  it('todas as ofertas suspeitas → median/avg null, count 0', () => {
    const flagged = filterOutliers([offer(3), offer(300)], 36);
    const stats = recomputeStats(flagged);
    expect(stats).toEqual({ median: null, avg: null, count: 0 });
  });

  it('mediana com número par de ofertas válidas → média das 2 centrais (half-up)', () => {
    const flagged = filterOutliers([offer(10), offer(20), offer(30), offer(41)], null);
    // ordenado: 10,20,30,41 → mediana = (20+30)/2 = 25
    const stats = recomputeStats(flagged);
    expect(stats.median).toBe(25);
  });

  it('lista vazia → median/avg null, count 0', () => {
    expect(recomputeStats([])).toEqual({ median: null, avg: null, count: 0 });
  });
});
