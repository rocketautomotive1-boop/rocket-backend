import {
  computeAnalysis, evaluateTriggers, shouldRealert, SnapshotPoint,
} from './price-analysis';

const NOW = new Date('2026-07-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** N snapshots válidos espalhados em N dias distintos, todos com o mesmo min/median. */
const flatHistory = (n: number, price: number): SnapshotPoint[] =>
  Array.from({ length: n }, (_, i) => ({ min: price, median: price, count: 5, scannedAt: daysAgo(i + 1) }));

describe('computeAnalysis', () => {
  it('média móvel (base=mediana) usa só janela de 14d e ignora snapshots com erro/min null', () => {
    const points: SnapshotPoint[] = [
      { min: 10, median: 10, count: 3, scannedAt: daysAgo(1) },
      { min: 20, median: 20, count: 3, scannedAt: daysAgo(2) },
      { min: 99, median: 99, count: 3, scannedAt: daysAgo(2), error: 'timeout' }, // fora
      { min: null, median: null, count: 0, scannedAt: daysAgo(3) },              // fora
      { min: 500, median: 500, count: 3, scannedAt: daysAgo(20) },               // fora da janela
    ];
    const a = computeAnalysis(points, NOW);
    expect(a.movingAvg).toBe(15);
    expect(a.allTimeLow).toBe(10); // all-time considera TODO o histórico válido
    expect(a.validSnapshots).toBe(3); // 10, 20, 500
    expect(a.distinctDays).toBe(3);
  });

  it('histórico vazio → tudo null/zero', () => {
    const a = computeAnalysis([], NOW);
    expect(a).toEqual({ movingAvg: null, allTimeLow: null, validSnapshots: 0, distinctDays: 0 });
  });

  it('média móvel usa a MEDIANA, não o min — promoção relâmpago isolada não a desloca', () => {
    // 6 dias com mediana estável em 100 (mercado "normal"); em 1 desses dias um
    // único vendedor fez uma promoção relâmpago que derrubou o min pra 10, mas a
    // mediana do ciclo continuou 100 (só ele estava baixo).
    const points: SnapshotPoint[] = Array.from({ length: 6 }, (_, i) => ({
      min: i === 0 ? 10 : 100, median: 100, count: 5, scannedAt: daysAgo(i + 1),
    }));
    const a = computeAnalysis(points, NOW);
    expect(a.movingAvg).toBe(100); // não é puxado pro min de 10 — reflete o mercado real
    expect(a.allTimeLow).toBe(10); // all-time-low continua vendo o extremo (gatilho separado)
  });
});

describe('evaluateTriggers', () => {
  const base = { currentCount: 5, thresholdPct: 15 };

  it('below_target vence e funciona SEM histórico (1º ciclo)', () => {
    const analysis = computeAnalysis([], NOW);
    const r = evaluateTriggers({ ...base, current: 9.9, targetPrice: 10, analysis });
    expect(r).toBe('below_target');
  });

  it('sem histórico mínimo (5 snapshots / 3 dias), gatilhos 2 e 3 NÃO armam', () => {
    const analysis = computeAnalysis(flatHistory(4, 100), NOW); // só 4 snapshots
    const r = evaluateTriggers({ ...base, current: 1, targetPrice: null, analysis });
    expect(r).toBeNull();
  });

  it('all_time_low quando atual < menor histórico', () => {
    const analysis = computeAnalysis(flatHistory(6, 100), NOW);
    const r = evaluateTriggers({ ...base, current: 99, targetPrice: null, analysis });
    expect(r).toBe('all_time_low');
  });

  it('below_moving_avg quando atual <= média * 0.85', () => {
    const points = [...flatHistory(6, 100), { min: 80, median: 80, count: 5, scannedAt: daysAgo(7) }];
    const analysis = computeAnalysis(points, NOW);
    // média = (600+80)/7 = 97.14; 82.5 <= 97.14*0.85 = 82.569 → dispara (não é ATL: 80 < 82.5)
    const r = evaluateTriggers({ ...base, current: 82.5, targetPrice: null, analysis });
    expect(r).toBe('below_moving_avg');
  });

  it('count < 2 no ciclo atual bloqueia below_moving_avg (1 vendedor fora da curva)', () => {
    const points = [...flatHistory(6, 100), { min: 80, median: 80, count: 5, scannedAt: daysAgo(7) }];
    const analysis = computeAnalysis(points, NOW);
    const r = evaluateTriggers({ ...base, current: 82.5, currentCount: 1, targetPrice: null, analysis });
    expect(r).toBeNull();
  });

  it('preço normal → null', () => {
    const analysis = computeAnalysis(flatHistory(6, 100), NOW);
    const r = evaluateTriggers({ ...base, current: 100, targetPrice: null, analysis });
    expect(r).toBeNull();
  });
});

describe('shouldRealert', () => {
  it('só re-alerta com queda de mais 5% sobre o preço do último alerta', () => {
    expect(shouldRealert(100, 95)).toBe(true);
    expect(shouldRealert(100, 95.01)).toBe(false);
  });
});
