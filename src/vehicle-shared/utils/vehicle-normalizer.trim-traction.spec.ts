import {
  extractCabType,
  extractEngineDisplay,
  extractTraction,
  extractTrim,
  toTitleCasePtBr,
} from './vehicle-normalizer.util';

describe('extractEngineDisplay', () => {
  it('extrai "1.0" de "1.0 5p"', () => {
    expect(extractEngineDisplay('1.0 5p')).toBe('1.0');
  });

  it('extrai "1.8" de "1.8 Adventure Locker Flex 5p"', () => {
    expect(extractEngineDisplay('1.8 Adventure Locker Flex 5p')).toBe('1.8');
  });

  it('normaliza vírgula para ponto', () => {
    expect(extractEngineDisplay('1,4 Flex 4p')).toBe('1.4');
  });

  it('retorna undefined para entrada vazia', () => {
    expect(extractEngineDisplay('')).toBeUndefined();
    expect(extractEngineDisplay(undefined as any)).toBeUndefined();
  });

  it('retorna undefined sem padrão de cilindrada reconhecível', () => {
    expect(extractEngineDisplay('Adventure 5p')).toBeUndefined();
  });
});

describe('extractTraction', () => {
  it('detecta "4x4" -> "4x4"', () => {
    expect(extractTraction('2.4 Triton Sport Outdoor Cab. Dupla 4X4 Aut. 4P')).toBe('4x4');
  });

  it('detecta "4wd" -> "4x4"', () => {
    expect(extractTraction('3.0 V6 Gt 4wd 5p')).toBe('4x4');
  });

  it('detecta "4x2" -> "4x2"', () => {
    expect(extractTraction('2.8 Cd 4x2 Diesel')).toBe('4x2');
  });

  it('detecta "awd" -> "awd"', () => {
    expect(extractTraction('2.0 Awd Turbo 4p')).toBe('awd');
  });

  it('retorna undefined sem menção de tração', () => {
    expect(extractTraction('1.8 Adventure Locker Flex 5p')).toBeUndefined();
  });

  it('retorna undefined para entrada vazia', () => {
    expect(extractTraction('')).toBeUndefined();
    expect(extractTraction(undefined as any)).toBeUndefined();
  });
});

describe('toTitleCasePtBr', () => {
  it('capitaliza palavras normais', () => {
    expect(toTitleCasePtBr('cab. dupla')).toBe('Cab. Dupla');
  });

  it('preserva acentos e capitaliza corretamente', () => {
    expect(toTitleCasePtBr('furgão sport')).toBe('Furgão Sport');
  });

  it('mantém siglas conhecidas em uppercase', () => {
    expect(toTitleCasePtBr('rs turbo')).toBe('RS Turbo');
    expect(toTitleCasePtBr('glx')).toBe('GLX');
  });

  it('colapsa espaços extras', () => {
    expect(toTitleCasePtBr('  adventure   locker  ')).toBe('Adventure Locker');
  });

  it('retorna vazio para entrada vazia', () => {
    expect(toTitleCasePtBr('')).toBe('');
  });
});

describe('extractTrim', () => {
  it('extrai trim de "1.8 Adventure Locker Flex 5p"', () => {
    expect(extractTrim('1.8 Adventure Locker Flex 5p')).toBe('Adventure Locker');
  });

  it('extrai trim de picape com cabine dupla e tração, sem incluir a cabine no trim', () => {
    expect(extractTrim('2.4 Triton Sport Outdoor Cab. Dupla 4X4 Aut. 4P')).toBe(
      'Triton Sport Outdoor',
    );
  });

  it('mantém sigla em uppercase no trim', () => {
    expect(extractTrim('1.6 Rs Turbo Aut. 5p')).toBe('RS Turbo');
  });

  it('mantém sigla LS em uppercase no trim', () => {
    expect(extractTrim('2.4 Ls Cab. Dupla 4x2 Flex 4p')).toBe('LS');
  });

  it('retorna undefined quando não sobra nada além de motor/portas', () => {
    expect(extractTrim('2.0 5p')).toBeUndefined();
  });

  it('retorna undefined para entrada vazia', () => {
    expect(extractTrim('')).toBeUndefined();
    expect(extractTrim(undefined as any)).toBeUndefined();
  });

  it('remove cilindrada em formato "cc"', () => {
    expect(extractTrim('1000 cc Turbo Sport 5p')).toBe('Turbo Sport');
  });
});

describe('extractCabType', () => {
  it('detecta "Cab. Dupla" -> "dupla"', () => {
    expect(extractCabType('2.4 Triton Sport Outdoor Cab. Dupla 4X4 Aut. 4P')).toBe('dupla');
  });

  it('detecta "Cabine Simples" -> "simples"', () => {
    expect(extractCabType('1.4 Cabine Simples Flex 2p')).toBe('simples');
  });

  it('detecta "Cab Dupla" sem ponto -> "dupla"', () => {
    expect(extractCabType('2.8 Cd Cab Dupla 4x2 Diesel')).toBe('dupla');
  });

  it('retorna undefined sem menção de cabine', () => {
    expect(extractCabType('1.8 Adventure Locker Flex 5p')).toBeUndefined();
  });

  it('retorna undefined para entrada vazia', () => {
    expect(extractCabType('')).toBeUndefined();
    expect(extractCabType(undefined as any)).toBeUndefined();
  });
});
