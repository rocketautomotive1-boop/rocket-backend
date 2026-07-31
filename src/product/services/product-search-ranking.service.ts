import { Injectable } from '@nestjs/common';
import { normalizeCode } from '../utils/code-key.util';

export interface RankingCandidate {
  id: string;
  /** name/displayName do produto — retrieval via product_autocomplete/product_text_search. */
  ownText?: string;
  /** partNumberKey/oemCodesKeys já casados pelo retrieval (bruto, não normalizado). */
  ownCode?: string;
  /** vehicleName das linhas de product_compatibilities que o retrieval encontrou pra este produto. */
  applicationTexts?: string[];
  /** catalogAttributes[].value do produto (ex: "Lubrificante", "Papel") — ver design doc 2026-07-25-search-ranking-noise-floor. */
  attributeTexts?: string[];
  /** isUniversalFit — elegível mesmo sem nenhum match textual. */
  isUniversal?: boolean;
  /**
   * true quando este candidato foi resolvido via compound-key marca+código
   * (resolveCompoundBrandCodeMatches — ex. "MBB 0000535358") — desempate
   * determinístico para o caso em que DOIS produtos compartilham o mesmo
   * código cross-reference legítimo (ex. "0000535358" em Spaal Juntas E
   * Elring): ambos batem codeMatch=1.0 igualmente via ownCode, mas só um
   * foi de fato resolvido pelo par {brandKey, codeKey} digitado. Ver design
   * doc 2026-07-25-search-ranking-noise-floor.
   */
  resolvedViaCompoundKey?: boolean;
}

/**
 * Ranking determinístico sobre candidatos já retrievados (design docs
 * 2026-07-24-product-search-ranking-pipeline-design.md e
 * 2026-07-25-search-ranking-noise-floor-design.md). Não faz I/O — recebe
 * texto real (não score de Lucene) e compara string contra string em JS puro.
 *
 * Por que não usar score do Atlas Search para ranking: score de índices Lucene
 * diferentes não é comparável (corpus, campos e distribuição diferentes por
 * índice) — comparar/somar/pesar esses números causou bugs recorrentes durante
 * o desenvolvimento do autocomplete (ver design doc, seção Contexto). Atlas
 * Search aqui só faz RETRIEVAL (achar candidatos plausíveis via fuzzy/
 * edgeGram, tolerante); esta classe faz o RANKING (decidir a ordem).
 */
@Injectable()
export class ProductSearchRankingService {
  // Prioridade de sinal, maior peso primeiro: código próprio > aplicação/
  // veículo > texto genérico do produto > atributo. Reflete casos reais
  // observados durante o design: "MBB 0000535358" deve resolver por código
  // (compound-key marca+código); "filtro combustivel renegade" deve resolver
  // pelo produto cuja aplicação é Renegade, mesmo com nome de produto
  // genérico ("Filtro de Combustível") competindo por match textual forte;
  // atributo (catalogAttributes.value) é o sinal mais fraco — dado
  // estruturado mas de qualidade variável entre catálogos, nunca deve
  // sozinho superar um match de nome/título real.
  private static readonly CODE_WEIGHT = 3;
  private static readonly APPLICATION_WEIGHT = 2;
  private static readonly TEXT_WEIGHT = 1;
  private static readonly ATTRIBUTE_WEIGHT = 0.3;
  // Boost de desempate determinístico pra candidato resolvido via compound-key
  // marca+código — maior que a soma máxima plausível dos pesos acima (nunca
  // decide sozinho quem entra no resultado, só quem vence um empate de score
  // de código idêntico entre produtos que compartilham o mesmo cross-reference).
  private static readonly COMPOUND_KEY_BOOST = 10;
  // Piso pra produto universal nunca ficar de fora quando nenhum outro sinal
  // bate, mas nunca competir à frente de um match textual real (piso bem
  // abaixo de qualquer combinação plausível dos pesos acima).
  private static readonly UNIVERSAL_FLOOR = 0.01;
  // Faixa Unicode dos combining diacritical marks (U+0300-U+036F) produzidos
  // por normalize('NFD') — separa a letra base do acento, este regex remove
  // só o acento. Mesmo padrão de product-slug.util.ts.
  private static readonly DIACRITICS_REGEX = /[̀-ͯ]/g;
  // Stopwords PT-BR (artigos/preposições) removidas só da QUERY digitada, nunca
  // do texto indexado — ver design doc 2026-07-25-search-ranking-noise-floor.
  // Bug real: "de" (2 chars) bate como match "completo" (shorterLen>=2, prefixo
  // total) contra QUALQUER token que também comece com "de" — quase todo nome
  // de produto tem "de" em algum lugar ("Filtro DE Combustível"), inflando o
  // score de produtos sem nenhuma relação real com a query ("filtro DE cabine"
  // batia "Filtro de Combustível" tão bem quanto "Filtro de Cabine", só pela
  // preposição compartilhada). Lista curta e fechada, normalizada (sem
  // acento/case) porque comparada só depois do fold em tokenize().
  private static readonly STOPWORDS = new Set([
    'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o', 'os', 'as', 'um', 'uma',
  ]);

  rankCandidates(query: string, candidates: RankingCandidate[]): Array<{ id: string; score: number }> {
    const queryWords = this.tokenize(query).filter((w) => !ProductSearchRankingService.STOPWORDS.has(w.toLowerCase()));

    return candidates
      .map((c) => ({ id: c.id, score: this.scoreCandidate(queryWords, c) }))
      .sort((a, b) => b.score - a.score);
  }

  private scoreCandidate(queryWords: string[], candidate: RankingCandidate): number {
    const codeMatch = this.bestPrefixMatchStrength(queryWords, this.tokenize(candidate.ownCode));
    const textMatch = this.bestPrefixMatchStrength(queryWords, this.tokenize(candidate.ownText));
    const applicationMatch = this.bestPrefixMatchStrength(
      queryWords,
      (candidate.applicationTexts ?? []).flatMap((t) => this.tokenize(t)),
    );
    const attributeMatch = this.bestPrefixMatchStrength(
      queryWords,
      (candidate.attributeTexts ?? []).flatMap((t) => this.tokenize(t)),
    );

    const score =
      codeMatch * ProductSearchRankingService.CODE_WEIGHT +
      applicationMatch * ProductSearchRankingService.APPLICATION_WEIGHT +
      textMatch * ProductSearchRankingService.TEXT_WEIGHT +
      attributeMatch * ProductSearchRankingService.ATTRIBUTE_WEIGHT +
      (candidate.resolvedViaCompoundKey ? ProductSearchRankingService.COMPOUND_KEY_BOOST : 0);

    if (score === 0 && candidate.isUniversal) return ProductSearchRankingService.UNIVERSAL_FLOOR;
    return score;
  }

  /**
   * Tokens normalizados de um texto livre: split por não-alfanumérico ANTES
   * de normalizar cada palavra individualmente (não normalizeCode(text)
   * inteiro seguido de split) — normalizeCode remove espaço junto com
   * pontuação, então rodá-lo na string inteira primeiro colaria "Jeep
   * Renegade" em "JEEPRENEGADE" um único token, e nenhuma palavra da query
   * bateria como prefixo dele (bug real encontrado testando esta função:
   * "rene" nunca batia contra aplicação "Jeep Renegade", porque virava
   * prefixo de "JEEPRENEGADE", não de "RENEGADE"). Splitar primeiro preserva
   * a fronteira de palavra.
   *
   * Fold de acento (NFD + remoção de diacríticos, mesmo padrão de
   * product-slug.util.ts) DEPOIS de normalizeCode — usuário comumente digita
   * sem acento em português ("combustivel" por "combustível"), e o texto
   * indexado (nome de produto, aplicação) tem acento real. Sem isso, "oleo"
   * nunca batia contra "Óleo" (outro bug real encontrado testando esta
   * função: normalizeCode não remove diacrítico, só pontuação/espaço/case —
   * correto para código de peça, que não deveria ter acento, mas insuficiente
   * pra texto livre em português). Aplicado tanto na query quanto nos textos
   * candidatos (esta função é a única fonte de tokens em todo o serviço),
   * então os dois lados da comparação caem no mesmo espaço normalizado.
   */
  private tokenize(text?: string): string[] {
    if (!text) return [];
    return text
      .split(/[^A-Za-zÀ-ÿ0-9]+/)
      .filter((t) => t.length > 0)
      .map((t) => this.foldDiacritics(normalizeCode(t)));
  }

  private foldDiacritics(text: string): string {
    return text.normalize('NFD').replace(ProductSearchRankingService.DIACRITICS_REGEX, '');
  }

  /**
   * Força de match por proporção de prefixo: quantos caracteres do INÍCIO de
   * `word` batem contra o INÍCIO de `token`, dividido pelo tamanho de `token`.
   * "RENE" vs "RENEGADE" -> 4/8 = 0.5 — sinal fraco mas real de que o usuário
   * está digitando "Renegade" e ainda não terminou. "RENEGADE" vs "RENEGADE"
   * -> 1.0. Proporção de prefixo (não Levenshtein/edit-distance): barato de
   * calcular em JS puro sobre N candidatos, e captura bem o caso de "usuário
   * ainda digitando" que motivou este design — erro de digitação NO MEIO da
   * palavra é uma frente diferente, já coberta pelo fuzzy do Atlas Search no
   * retrieval (que já deixou o candidato entrar no conjunto antes de chegar
   * aqui; esta função só decide o quão bem ele bate agora).
   *
   * PISO DE QUALIDADE (ver design doc 2026-07-25-search-ranking-noise-floor):
   * um match só conta se a mais CURTA das duas strings (word ou token) for
   * (a) prefixo COMPLETO da mais longa — não prefixo parcial — e (b) tiver
   * pelo menos 2 caracteres. Sem esse piso, campos com muitos tokens (ex:
   * produto com 30+ oemCodesKeys) acumulam match espúrio de 1-2 caracteres
   * de prefixo (ex: "filtro" vs "FL568" bate só "F") que, multiplicado por
   * peso alto (CODE_WEIGHT=3) e somado sobre muitos tokens, supera um match
   * textual real — bug real encontrado com a query "filtro lubrificante"
   * contra um produto com nome genérico "Lubrificante FORD 1117" e dezenas
   * de códigos OEM, nenhum deles de fato relacionado à query.
   * "SL092" vs "SL" (token partido por hífen em "SL-092") passa no piso —
   * "SL" é prefixo completo de "SL092", mesmo sendo um token curto — porque
   * é exatamente o caso de código real que o design pretende continuar
   * suportando (ver teste "sl092 solopes").
   *
   * Média da MELHOR força de cada palavra da query contra os tokens do campo
   * (não só o melhor par global) — decisão deliberada, é o que diferencia
   * "várias palavras da query batem bem neste campo" (ex.: "filtro" +
   * "combustivel" batendo quase perfeito em "Filtro de Combustível") de "só
   * uma palavra bate bem" (ex.: só "rene"→"renegade" batendo, as outras duas
   * não aparecem na aplicação). Pegar só o melhor par global (implementação
   * anterior) fazia os dois casos pontuarem igual, porque cada um tem uma
   * combinação forte isolada — a média captura corretamente que "2 de 3
   * palavras bem" é evidência mais forte que "1 de 3 palavras muito bem".
   * Palavra da query sem NENHUM match em nenhum token conta 0 na média (não
   * é ignorada) — um campo que só cobre parte da query deve pontuar menos
   * que um que cobre a query inteira.
   */
  private bestPrefixMatchStrength(queryWords: string[], tokens: string[]): number {
    const relevantWords = queryWords.filter(Boolean);
    if (relevantWords.length === 0 || tokens.length === 0) return 0;

    let total = 0;
    for (const word of relevantWords) {
      let bestForWord = 0;
      for (const token of tokens) {
        if (!token) continue;
        const shorterLen = Math.min(word.length, token.length);
        if (shorterLen < 2) continue;
        const prefixLen = this.commonPrefixLength(word, token);
        if (prefixLen !== shorterLen) continue; // exige prefixo COMPLETO da string mais curta
        const strength = prefixLen / Math.max(token.length, word.length);
        if (strength > bestForWord) bestForWord = strength;
      }
      total += bestForWord;
    }
    return total / relevantWords.length;
  }

  private commonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i++;
    return i;
  }
}
