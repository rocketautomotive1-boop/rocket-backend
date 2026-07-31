import { ProductSearchRankingService, RankingCandidate } from './product-search-ranking.service';

describe('ProductSearchRankingService', () => {
  let service: ProductSearchRankingService;

  beforeEach(() => {
    service = new ProductSearchRankingService();
  });

  function scoreOf(query: string, candidates: RankingCandidate[], id: string): number {
    const ranked = service.rankCandidates(query, candidates);
    return ranked.find((r) => r.id === id)?.score ?? 0;
  }

  it('aplicação bate query completa vence texto genérico do produto, mesmo com nome comercial idêntico', () => {
    // Caso real: "filtro combustivel renegade" — Fiat genérico sem relação com
    // Renegade competindo contra Eurorepar cuja aplicação é literalmente Jeep Renegade.
    const candidates: RankingCandidate[] = [
      {
        id: 'fiat',
        ownText: 'Filtro de Combustível',
        applicationTexts: ['1.6 Hdi Business Pack Td Blue 5p'],
      },
      {
        id: 'euro',
        ownText: 'Filtro de Combustível',
        applicationTexts: ['2.0 limited 4x4 aut. 5p', 'Jeep Renegade'],
      },
    ];

    const ranked = service.rankCandidates('filtro combustivel renegade', candidates);
    expect(ranked[0].id).toBe('euro');
  });

  it('aplicação bate query PARCIAL (usuário ainda digitando) ainda favorece o produto certo', () => {
    const candidates: RankingCandidate[] = [
      {
        id: 'fiat',
        ownText: 'Filtro de Combustível',
        applicationTexts: ['1.6 Hdi Business Pack Td Blue 5p'],
      },
      {
        id: 'euro',
        ownText: 'Filtro de Combustível',
        applicationTexts: ['2.0 limited 4x4 aut. 5p', 'Jeep Renegade'],
      },
    ];

    const ranked = service.rankCandidates('filtro combustivel rene', candidates);
    expect(ranked[0].id).toBe('euro');
  });

  it('compound-key marca+código resolvido desempata entre dois produtos que compartilham o MESMO código cross-reference', () => {
    // Caso real: "0000535358" é código cross-reference legítimo em DOIS produtos de marcas
    // diferentes (Spaal Juntas e Elring) — o par {brandKey:"MBB", codeKey} resolve pro grupo
    // do produto certo (resolveCompoundBrandCodeMatches, retrieval), mas ambos batem
    // codeMatch=1.0 igualmente via ownCode. Sem o sinal de desempate, o ranking empata.
    const candidates: RankingCandidate[] = [
      {
        id: 'spaal',
        ownText: 'RETENTORES MERCEDES BENZ AXOR',
        ownCode: '489237F 09237BREF 0000535358 567401',
        resolvedViaCompoundKey: true,
      },
      {
        id: 'elring',
        ownText: 'RETENTOR Mercedes-Benz AXOR 2',
        ownCode: '567401 0000535358 1913734 51049020037',
      },
    ];

    const ranked = service.rankCandidates('MBB 0000535358', candidates);
    expect(ranked[0].id).toBe('spaal');
    expect(scoreOf('MBB 0000535358', candidates, 'spaal')).toBeGreaterThan(
      scoreOf('MBB 0000535358', candidates, 'elring'),
    );
  });

  it('código exato (mesmo com marca de cross-reference diferente da marca do produto) domina o ranking', () => {
    // Caso real: "MBB 0000535358" resolvido via compound-key marca+código
    // (KnownBrandKeysCacheService) — o produto retornado pelo retrieval já
    // TEM o código certo em ownCode; um competidor sem esse código não deve vencer.
    const candidates: RankingCandidate[] = [
      { id: 'correct', ownText: 'RETENTORES MERCEDES BENZ AXOR', ownCode: '0000535358' },
      { id: 'other', ownText: 'Retentor Genérico Mercedes Similar' },
    ];

    const ranked = service.rankCandidates('MBB 0000535358', candidates);
    expect(ranked[0].id).toBe('correct');
  });

  it('código + marca do próprio produto (sl092 solopes) pontua bem via ownCode', () => {
    const candidates: RankingCandidate[] = [
      { id: 'kbt', ownText: 'SUSPENSÃO CITROEN C4', ownCode: 'SL-092' },
      { id: 'unrelated', ownText: 'Parafuso Genérico' },
    ];

    const ranked = service.rankCandidates('sl092 solopes', candidates);
    expect(ranked[0].id).toBe('kbt');
    expect(scoreOf('sl092 solopes', candidates, 'kbt')).toBeGreaterThan(0);
  });

  it('produto universal nunca fica em zero quando nenhum outro sinal bate', () => {
    const candidates: RankingCandidate[] = [
      { id: 'universal', ownText: 'Óleo Universal', isUniversal: true },
      { id: 'nonUniversal', ownText: 'Parafuso Genérico' },
    ];

    const ranked = service.rankCandidates('zzzznotmatchinganything', candidates);
    const universal = ranked.find((r) => r.id === 'universal')!;
    const nonUniversal = ranked.find((r) => r.id === 'nonUniversal')!;
    expect(universal.score).toBeGreaterThan(0);
    expect(universal.score).toBeGreaterThan(nonUniversal.score);
  });

  it('produto universal nunca vence um match textual real de outro campo', () => {
    const candidates: RankingCandidate[] = [
      // "universal" não menciona "filtro" em lugar nenhum — só é elegível pelo piso.
      { id: 'universal', ownText: 'Óleo Universal', isUniversal: true },
      { id: 'strongMatch', ownText: 'Filtro de Óleo Sintético Castrol' },
    ];

    const ranked = service.rankCandidates('filtro oleo', candidates);
    expect(ranked[0].id).toBe('strongMatch');
  });

  it('ignora acento na query e no texto indexado (usuário digita sem acento)', () => {
    const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Óleo 5w30 Sintético' }];

    const withAccent = scoreOf('óleo sintético', candidates, 'p1');
    const withoutAccent = scoreOf('oleo sintetico', candidates, 'p1');
    expect(withoutAccent).toBeCloseTo(withAccent, 5);
    expect(withoutAccent).toBeGreaterThan(0);
  });

  it('não junta palavras de campos com múltiplos tokens em um só (regressão: "Jeep Renegade" não pode virar "JEEPRENEGADE")', () => {
    const candidates: RankingCandidate[] = [
      { id: 'p1', ownText: 'Peça genérica', applicationTexts: ['Jeep Renegade'] },
    ];

    // Se o bug de tokenização voltasse, "rene" nunca bateria porque o token
    // seria "JEEPRENEGADE" (prefixo "J", não "R") em vez de "JEEP" + "RENEGADE".
    expect(scoreOf('rene', candidates, 'p1')).toBeGreaterThan(0);
  });

  it('query vazia ou só espaço não gera score para nenhum candidato', () => {
    const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Qualquer Coisa' }];
    expect(scoreOf('   ', candidates, 'p1')).toBe(0);
  });

  describe('piso de qualidade de match (ruído de prefixo curto)', () => {
    it('produto com muitos oemCodesKeys não acumula ruído de código a ponto de vencer match textual real', () => {
      // Caso real do bug: "Lubrificante FORD 1117" tem 32 oemCodesKeys; um deles
      // ("FL568") bate 1 char de prefixo com "filtro" (ruído, descartado pelo piso),
      // outro ("LUS6714CCB") bate 2 chars com "lubrificante" (ruído, descartado).
      // O produto ainda pontua > 0 porque "lubrificante" bate de verdade no PRÓPRIO
      // nome — mas isso sozinho (1 de 2 palavras da query) não deve superar o
      // produto certo, que bate as duas palavras via sinônimo do título.
      const candidates: RankingCandidate[] = [
        {
          id: 'filtroDeOleo',
          ownText: 'Filtro de Óleo filtro lubrificante', // titleText + subtitle + synonyms
        },
        {
          id: 'lubrificanteGenerico',
          ownText: 'Lubrificante FORD 1117',
          ownCode: 'PSL568 FOL0568 B218 0986B01022 EFL963 FL568 FA33 LF4112 LUS6714CCB LB568',
        },
      ];

      const ranked = service.rankCandidates('filtro lubrificante', candidates);
      expect(ranked[0].id).toBe('filtroDeOleo');
      expect(scoreOf('filtro lubrificante', candidates, 'lubrificanteGenerico')).toBeLessThan(
        scoreOf('filtro lubrificante', candidates, 'filtroDeOleo'),
      );
    });

    it('match de prefixo curto isolado (sem cobrir o token inteiro) não conta como sinal', () => {
      const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Peça Genérica', ownCode: 'FL568' }];
      expect(scoreOf('filtro', candidates, 'p1')).toBe(0);
    });

    it('query de 1 caractere não gera match mesmo sendo prefixo exato de um token', () => {
      const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Filtro de Óleo' }];
      expect(scoreOf('f', candidates, 'p1')).toBe(0);
    });

    it('mantém válido o caso "sl092 solopes" (token curto por hífen, prefixo COMPLETO do token)', () => {
      const candidates: RankingCandidate[] = [
        { id: 'kbt', ownText: 'SUSPENSÃO CITROEN C4', ownCode: 'SL-092' },
        { id: 'unrelated', ownText: 'Parafuso Genérico' },
      ];
      const ranked = service.rankCandidates('sl092 solopes', candidates);
      expect(ranked[0].id).toBe('kbt');
      expect(scoreOf('sl092 solopes', candidates, 'kbt')).toBeGreaterThan(0);
    });

    it('mantém válidos os casos de match parcial já suportados (rene->renegade, fap9->fap-9297)', () => {
      const candidates: RankingCandidate[] = [
        { id: 'p1', ownText: 'Peça', applicationTexts: ['Jeep Renegade'] },
        { id: 'p2', ownText: 'Peça', ownCode: 'FAP-9297' },
      ];
      expect(scoreOf('rene', candidates, 'p1')).toBeGreaterThan(0);
      expect(scoreOf('fap9', candidates, 'p2')).toBeGreaterThan(0);
    });
  });

  describe('stopwords PT-BR não contam como sinal de match', () => {
    it('"de" (preposição) não infla o score de um produto que não tem relação com a query', () => {
      // Caso real: "filtro de cabine" — "Filtro de Combustível" (irrelevante) não deve
      // vencer "Filtro de Cabine" (correto) só porque ambos têm "de" no nome.
      const candidates: RankingCandidate[] = [
        { id: 'combustivel', ownText: 'Filtro de Combustível' },
        { id: 'cabine', ownText: 'Filtro de Cabine' },
      ];
      const ranked = service.rankCandidates('filtro de cabine', candidates);
      expect(ranked[0].id).toBe('cabine');
      expect(scoreOf('filtro de cabine', candidates, 'combustivel')).toBe(
        scoreOf('filtro cabine', candidates, 'combustivel'), // "de" não muda nada
      );
    });

    it('produto cujo ÚNICO match é uma stopword pontua 0, não um valor residual', () => {
      const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Peça Genérica de Reposição' }];
      expect(scoreOf('de', candidates, 'p1')).toBe(0);
    });

    it('stopword no MEIO de uma query maior é ignorada, resto da query continua pontuando normal', () => {
      const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Filtro de Cabine' }];
      const withStopword = scoreOf('filtro de cabine', candidates, 'p1');
      const withoutStopword = scoreOf('filtro cabine', candidates, 'p1');
      expect(withStopword).toBe(withoutStopword);
      expect(withStopword).toBeGreaterThan(0);
    });
  });

  describe('sinal de atributo (catalogAttributes.value)', () => {
    it('candidato cujo único match é via attributeTexts pontua acima de zero', () => {
      const candidates: RankingCandidate[] = [
        { id: 'p1', ownText: 'Peça Sem Relação Nenhuma', attributeTexts: ['Lubrificante'] },
      ];
      expect(scoreOf('lubrificante', candidates, 'p1')).toBeGreaterThan(0);
    });

    it('match de atributo pontua menos que match textual equivalente no nome', () => {
      const viaAttribute: RankingCandidate[] = [
        { id: 'p1', ownText: 'Peça Sem Relação', attributeTexts: ['Lubrificante'] },
      ];
      const viaText: RankingCandidate[] = [{ id: 'p2', ownText: 'Filtro Lubrificante' }];

      const attributeScore = scoreOf('lubrificante', viaAttribute, 'p1');
      const textScore = scoreOf('lubrificante', viaText, 'p2');
      expect(attributeScore).toBeGreaterThan(0);
      expect(attributeScore).toBeLessThan(textScore);
    });

    it('match de atributo abaixo do piso de qualidade não pontua', () => {
      // "lubrificante" (query) vs "lus6714ccb" (atributo hipotético/código): só os
      // 2 primeiros chars batem ("LU"), não é prefixo completo de nenhum dos dois.
      const candidates: RankingCandidate[] = [{ id: 'p1', ownText: 'Peça', attributeTexts: ['LUS6714CCB'] }];
      expect(scoreOf('lubrificante', candidates, 'p1')).toBe(0);
    });

    it('atributo nunca supera sozinho um match textual forte de outro campo', () => {
      const candidates: RankingCandidate[] = [
        { id: 'weakAttr', ownText: 'Peça Genérica', attributeTexts: ['Combustível'] },
        { id: 'strongText', ownText: 'Filtro de Combustível' },
      ];
      const ranked = service.rankCandidates('combustivel', candidates);
      expect(ranked[0].id).toBe('strongText');
    });
  });
});
