import { lookupShipping, reputationBucket, shippingModeFor } from './ml-shipping-table';

const T = (reputation: any, weightKg: number, price: number) =>
  lookupShipping({ mode: 'traditional', reputation, weightKg, price });
const F = (weightKg: number, price: number) =>
  lookupShipping({ mode: 'full', reputation: 'red', weightKg, price });

describe('lookupShipping — Tradicional (tabela oficial ML)', () => {
  it('GREEN: até 0,3kg, R$79-99,99 → R$12,35', () => {
    expect(T('green', 0.25, 99)).toBe(12.35);
  });
  it('GREEN: 0,5-1kg, R$100-119,99 → R$16,15', () => {
    expect(T('green', 0.7, 110)).toBe(16.15);
  });
  it('GREEN: 2-3kg, R$0-18,99 → R$6,35', () => {
    expect(T('green', 2.5, 15)).toBe(6.35);
  });
  it('YELLOW: até 0,3kg, R$79-99,99 → R$14,82', () => {
    expect(T('yellow', 0.25, 99)).toBe(14.82);
  });
  it('RED: até 0,3kg, R$79-99,99 → R$24,70', () => {
    expect(T('red', 0.25, 99)).toBe(24.70);
  });
  it('RED: a partir de R$200, mais de 150kg → R$523,90', () => {
    expect(T('red', 200, 500)).toBe(523.90);
  });
  it('limite exato: peso 0.3kg cai na 1ª faixa; preço 79 cai na faixa 79-99,99', () => {
    expect(T('green', 0.3, 79)).toBe(12.35);
  });
  it('sem peso → null', () => {
    expect(T('green', 0, 99)).toBeNull();
  });
});

describe('lookupShipping — Full Super', () => {
  it('até 0,3kg, R$79-98,99 → R$4,00', () => {
    expect(F(0.25, 90)).toBe(4.00);
  });
  it('até 0,3kg, a partir de R$199 → R$20,95', () => {
    expect(F(0.25, 250)).toBe(20.95);
  });
  it('1-2kg, R$99-198,99 → R$6,50', () => {
    expect(F(1.5, 150)).toBe(6.50);
  });
  it('regra <R$29 paga no máx 25% do preço: 0,25kg @ R$10 → min(1.25, 2.50)=1.25', () => {
    // a 0..18,99 já é 1.25 (<2.5), então o cap não reduz; testar caso onde cap morde:
    // 6-7kg @ R$10 → tabela col0 = 4.00, cap 25%*10=2.50 → 2.50
    expect(F(6.5, 10)).toBe(2.50);
  });
});

describe('shippingModeFor', () => {
  it('fulfillment → full; resto → traditional', () => {
    expect(shippingModeFor('fulfillment')).toBe('full');
    expect(shippingModeFor('drop_off')).toBe('traditional');
    expect(shippingModeFor('self_service')).toBe('traditional');
  });
});

describe('reputationBucket', () => {
  it('mapeia level_id do ML', () => {
    expect(reputationBucket('5_green')).toBe('green');
    expect(reputationBucket('4_yellow')).toBe('yellow');
    expect(reputationBucket('2_orange')).toBe('red');
    expect(reputationBucket('1_red')).toBe('red');
    expect(reputationBucket(null)).toBe('green');
  });
});
