import { parseVehicleQuery } from './vehicle-query-parser.util';

describe('parseVehicleQuery', () => {
  it('extrai make/model, faixa de ano, combustível e motor de "Fiat Toro 2.0 2016-2021 Diesel"', () => {
    const result = parseVehicleQuery('Fiat Toro 2.0 2016-2021 Diesel');
    expect(result.freeText).toBe('Fiat Toro');
    expect(result.yearRange).toEqual({ from: 2016, to: 2021 });
    expect(result.fuelTags).toEqual(['diesel']);
    expect(result.engineDisplay).toBe('2.0');
  });

  it('é independente da ordem dos tokens', () => {
    const result = parseVehicleQuery('2016-2021 Diesel Fiat Toro 2.0');
    expect(result.freeText).toBe('Fiat Toro');
    expect(result.yearRange).toEqual({ from: 2016, to: 2021 });
    expect(result.fuelTags).toEqual(['diesel']);
    expect(result.engineDisplay).toBe('2.0');
  });

  it('normaliza faixa de ano digitada invertida ("2021-2016")', () => {
    const result = parseVehicleQuery('Corolla 2021-2016');
    expect(result.yearRange).toEqual({ from: 2016, to: 2021 });
  });

  it('query só com make/model retorna apenas freeText', () => {
    const result = parseVehicleQuery('Corolla');
    expect(result.freeText).toBe('Corolla');
    expect(result.yearRange).toBeUndefined();
    expect(result.fuelTags).toBeUndefined();
    expect(result.engineDisplay).toBeUndefined();
  });

  it('extrai motor "l200 2.5" sem pegar veículos de 2.4', () => {
    const result = parseVehicleQuery('l200 2.5');
    expect(result.freeText).toBe('l200');
    expect(result.engineDisplay).toBe('2.5');
  });

  it('query só com faixa de ano retorna freeText vazio', () => {
    const result = parseVehicleQuery('2016-2021');
    expect(result.freeText).toBe('');
    expect(result.yearRange).toEqual({ from: 2016, to: 2021 });
  });
});
