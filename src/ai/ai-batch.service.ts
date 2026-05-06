import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductDraftModel, ProductDraftDocument } from '../product/product-types';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { CanonicalProfile } from '../shared/dto/discovery-response.dto';

type BatchItemInput = { url?: string; base64?: string; mimeType?: string; filename?: string; text?: string };

@Injectable()
export class AiBatchService {
  private readonly modelName = 'gemini-3-flash-preview';
  private ai: GoogleGenAI | null = null;

  constructor(
    @InjectModel(ProductDraftModel.name)
    private readonly draftModel: Model<ProductDraftDocument>,
    private readonly config: ConfigService,
  ) {
    const key = this.config.get<string>('GEMINI_API_KEY') || this.config.get<string>('EXPO_PUBLIC_GEMINI_API_KEY');
    if (key) this.ai = new GoogleGenAI({ apiKey: key });
  }

  async createBatch(items: BatchItemInput[]) {
    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const drafts = items.map(it => ({
      batchId,
      sourceImageUrl: it.url || null,
      sourceImageBase64: it.base64 || null,
      mimeType: it.mimeType || null,
      status: 'pending',
      data: null,
      error: null,
    }));
    await this.draftModel.insertMany(drafts);
    // Disparar processamento assíncrono simples
    setTimeout(() => { this.processBatch(batchId).catch(() => { }); }, 10);
    return batchId;
  }

  async createTextBatch(items: Array<{ text?: string; base64?: string; mimeType?: string }>) {
    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const drafts = items.map(it => ({
      batchId,
      sourceImageUrl: null,
      sourceImageBase64: it.base64 || null,
      mimeType: it.mimeType || null,
      status: 'pending',
      data: JSON.stringify({ notes: (it.text || '').trim() }),
      error: null,
    }));
    await this.draftModel.insertMany(drafts);
    setTimeout(() => { this.processBatch(batchId).catch(() => { }); }, 10);
    return batchId;
  }

  async processBatch(batchId: string) {
    const items = await this.draftModel.find({ batchId }).exec();
    for (const item of items) {
      await this.processSingleDraft(item);
    }
  }

  async processDraft(id: string) {
    const item = await this.draftModel.findById(id).exec();
    if (!item) throw new Error('Rascunho não encontrado');
    await this.processSingleDraft(item);
    return item;
  }

  private async processSingleDraft(item: any) {
    try {
      item.status = 'processing';
      await item.save();
      let notes: string | undefined = undefined;
      if (item.data) {
        try {
          const parsed = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
          if (parsed && typeof parsed.notes === 'string') {
            notes = parsed.notes;
          } else if (parsed) {
            // Se não tem campo 'notes' explícito, usa todo o objeto como contexto
            notes = JSON.stringify(parsed);
          }
        } catch {
          // Se não for JSON válido, usa a string direta
          if (typeof item.data === 'string') notes = item.data;
        }
      }
      const data = await this.processWithGemini((item as any).sourceImageBase64, item.mimeType || 'image/jpeg', notes);
      item.status = 'done';
      item.data = JSON.stringify(data);
      item.error = undefined as any;
      await item.save();
    } catch (e: any) {
      item.status = 'error';
      item.error = e?.message || 'Falha no processamento';
      await item.save();
    }
  }

  private async processWithGemini(imageBase64?: string | null, mimeType?: string, notes?: string) {
    const systemInstruction = `Você é "Gustavo - Identificador de peças automotivas". Seu objetivo é atuar como um especialista técnico para identificar peças automotivas e retornar todas as informações em formato JSON estrito.

1. ENTRADAS: Você receberá o "código da peça" (partNumber), "marca" (brand) ou uma IMAGEM.

2. SAÍDA OBRIGATÓRIA (JSON TÉCNICO):

JSON

{
  "partNumber": "<Código sem zeros à esquerda>",
  "brand": "<Marca Original>",
  "descricao": "<Nome Técnico da Peça (Ex: Bomba de Óleo)>",
  "detalhes": "<Texto comercial sobre o produto, diferenciais, tecnologia e benefícios>",
  "marcaOriginal": "<Montadora ou Fabricante Principal>",
  "codigoOriginal": "<Código de Referência Original>",
  "barcode": "<Somente dígitos ou omitir>",

  "atributos": [
    { "nome": "<Característica (Ex: Tensão)>", "valor": "<Valor (Ex: 12V)>" }
  ],
  "aplicacoes": [
    {
      "marca": "<Montadora (Ex: Fiat)>",
      "veiculos": [
        "<Modelo> <Motor> <AnoInicial>-<AnoFinal>",
        "<Modelo> <Motor> <AnoInicial>-<AnoFinal>"
      ]
    }
  ]
}

3. REGRAS DE NEGÓCIO:
- Código: Remova zeros à esquerda.
- Aplicacoes: Agrupe por MARCA. Para cada marca, liste os veículos compatíveis. Cada veículo deve ter Modelo, Motorização (se souber) e Ano. Exemplo: "Palio 1.8 2012-2017".
- Detalhes: Gere um texto rico e útil de 2 a 3 frases descrevendo a peça, seus materiais ou função principal.
- Lado: Se houver indicação de lado (Dir./Esq.), SEMPRE inclua na descrição por extenso: "Lado Direito" ou "Lado Esquerdo".
- Se houver muitas variações, liste as principais.
- Atributos: Extraia características técnicas relevantes se disponíveis/deduzíveis.

4. TOM E ERROS: Resposta estritamente técnica. Se não identificar, retorne JSON com campos vazios.`;

    if (!this.ai) {
      return { partNumber: '', brand: '', descricao: '', detalhes: '', marcaOriginal: '', codigoOriginal: '', barcode: '', atributos: [], aplicacoes: [] };
    }

    const parts: any[] = [];
    if (imageBase64) {
      parts.push({ text: 'Identifique a peça automotiva a partir da imagem da etiqueta. Extraia o código da peça (partNumber), a marca e o código de barras (barcode) da imagem e use-os para a busca. Retorne o JSON correspondente.' });
      parts.push({ inlineData: { data: imageBase64, mimeType: mimeType || 'image/jpeg' } });
    } else if (notes && notes.trim().length > 0) {
      parts.push({ text: `Identifique a peça automotiva com base nas observações a seguir e retorne o JSON técnico conforme instruções. Observações: "${notes.trim()}"` });
    } else {
      return { partNumber: '', brand: '', descricao: '', detalhes: '', marcaOriginal: '', codigoOriginal: '', barcode: '', atributos: [], aplicacoes: [] };
    }

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: { parts },
      config: { systemInstruction, tools: [{ googleSearch: {} }] }
    });

    const candidateText = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
    const rawText = (response as any)?.text ?? candidateText ?? '';
    const text = (typeof rawText === 'string' ? rawText : '').trim();
    if (!text) {
      return { partNumber: '', brand: '', descricao: '', detalhes: '', marcaOriginal: '', codigoOriginal: '', barcode: '', atributos: [], aplicacoes: [] };
    }
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : text;
    try {
      const data = JSON.parse(jsonString);
      return data;
    } catch {
      return { partNumber: '', brand: '', descricao: '', detalhes: '', marcaOriginal: '', codigoOriginal: '', atributos: [], aplicacoes: [], observacoes: text };
    }
  }

  async ocrFromImage(imageBase64: string, mimeType?: string): Promise<string> {
    if (!this.ai || !imageBase64) return '';
    const instruction = `Você receberá uma imagem de etiqueta de peça automotiva.
Extraia EXCLUSIVAMENTE um dos seguintes valores:
- O código da peça (partNumber)
- Se não houver código, a marca oficial (montadora/fabricante principal)

RETORNE APENAS UM ÚNICO VALOR EM UMA LINHA:
- Priorize o partNumber se ambos estiverem disponíveis
- Não retorne frases, explicações ou múltiplos valores
- Não retorne códigos de barras (apenas dígitos longos)
- Remova quebras de linha e espaços extras
`;
    const parts: any[] = [];
    parts.push({ text: instruction });
    parts.push({ inlineData: { data: imageBase64, mimeType: mimeType || 'image/jpeg' } });
    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: { parts },
      });
      const candidateText = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
      const rawText = (response as any)?.text ?? candidateText ?? '';
      let text = (typeof rawText === 'string' ? rawText : '').replace(/\s+/g, ' ').trim();
      // Remover blocos markdown e prefixos comuns
      text = text.replace(/```[\s\S]*?```/g, '').trim();
      // Evitar retorno de códigos de barras (apenas dígitos longos)
      if (/^\d{11,}$/.test(text)) return '';
      // Limitar tamanho e limpar caracteres estranhos
      text = text.replace(/[^A-Za-z0-9\-\.\s]/g, '').trim();
      return text;
    } catch {
      return '';
    }
  }

  async getBatchStatus(batchId: string) {
    const items = await this.draftModel.find({ batchId }).sort({ _id: 1 }).exec();
    const total = items.length;
    const processed = items.filter(i => i.status === 'done').length;
    const failed = items.filter(i => i.status === 'error').length;
    const state = processed + failed === total ? 'complete' : (items.some(i => i.status === 'processing') ? 'processing' : 'pending');
    return {
      state,
      total,
      processed,
      failed,
      items: items.map(i => ({ id: (i as any)._id, status: i.status, data: i.data ? JSON.parse(i.data) : undefined, error: i.error })),
    };
  }

  async cancelBatch(batchId: string) {
    const items = await this.draftModel.find({ batchId }).exec();
    for (const item of items) {
      if (item.status === 'pending' || item.status === 'processing') {
        item.status = 'error';
        item.error = 'cancelled';
        await item.save();
      }
    }
  }

  async estimatePrice(partNumber: string, brand: string) {
    if (!this.ai) {
      throw new Error('Gemini API key not configured');
    }

    const prompt = `
      Você é um especialista em precificação de peças automotivas.
      Realize uma busca no Google EXCLUSIVAMENTE através do site:mercadolivre.com.br para encontrar o preço médio de mercado para a seguinte peça:

      Part Number: ${partNumber}
      Marca: ${brand}

      Retorne APENAS um JSON estrito com o seguinte formato, sem explicações adicionais:
      {
        "precoEstimado": {
          "minimo": "100.00",
          "maximo": "150.00",
          "moeda": "BRL"
        }
      }

      Regras:
      1. Os valores devem ser strings com duas casas decimais.
      2. Ignore anúncios usados ou de marcas inferiores se possível, foque em peças novas ou equivalentes de boa qualidade.
      3. Se não encontrar nada, retorne "minimo": "0.00", "maximo": "0.00".
      4. Não utilize informações de outros domínios.
    `;

    try {
      console.log('AI Estimate Price Prompt:', prompt);

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: { parts: [{ text: prompt }] },
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const candidateText = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
      const rawText = (response as any)?.text ?? candidateText ?? '';

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : rawText;

      return JSON.parse(jsonString);
    } catch (error: any) {
      console.error('Error estimating price:', error);
      throw new Error(`Failed to estimate price: ${error.message}`);
    }
  }

  /**
   * Builds a canonical keyword profile from collected titles.
   * No external search tool — derives profile only from the provided titles.
   */
  async buildCanonicalProfile(
    query: string,
    partNumber: string,
    titles: string[],
  ): Promise<CanonicalProfile> {
    const fallback: CanonicalProfile = {
      canonicalTitle: query,
      productType: '',
      canonicalPartNumber: partNumber,
      requiredKeywords: [],
      strongKeywords: [],
      optionalKeywords: [],
      negativeKeywords: [],
      vehicleHints: [],
    };

    if (!this.ai || titles.length === 0) return fallback;

    const titlesList = titles.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join('\n');
    const pnHint = partNumber ? `\nPart Number alvo: "${partNumber}"` : '';

    const prompt = `Você é um especialista em catálogo automotivo.
Query de busca: "${query}"${pnHint}

Títulos coletados de listagens:
${titlesList}

Com base EXCLUSIVAMENTE nos títulos acima, crie um perfil de filtro para identificar listagens corretas e rejeitar as erradas.

Retorne JSON estrito:
{
  "canonicalTitle": "título mais representativo do produto",
  "productType": "tipo do produto em português (ex: Amortecedor Dianteiro)",
  "requiredKeywords": ["termos que qualquer listagem correta DEVE conter (3 a 6 tokens simples)"],
  "strongKeywords": ["termos que os melhores matches têm em comum (2 a 4 tokens)"],
  "optionalKeywords": ["termos secundários que podem aparecer"],
  "negativeKeywords": ["termos que indicam produto ERRADO: PN diferente, lado errado, categoria diferente"],
  "vehicleHints": ["modelos e marcas de veículos mencionados"]
}

Regras:
- Use tokens simples (uma palavra por item) em requiredKeywords e negativeKeywords
- Não inclua "${partNumber}" em nenhuma lista (já tratado separadamente)
- Se os títulos forem insuficientes para determinar, retorne listas vazias`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: { parts: [{ text: prompt }] },
      });
      const candidateText = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
      const rawText = (response as any)?.text ?? candidateText ?? '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      return {
        canonicalTitle: parsed.canonicalTitle ?? query,
        productType: parsed.productType ?? '',
        canonicalPartNumber: partNumber,
        requiredKeywords: parsed.requiredKeywords ?? [],
        strongKeywords: parsed.strongKeywords ?? [],
        optionalKeywords: parsed.optionalKeywords ?? [],
        negativeKeywords: parsed.negativeKeywords ?? [],
        vehicleHints: parsed.vehicleHints ?? [],
      };
    } catch {
      return fallback;
    }
  }

  async sanitizeDiscoveryData(query: string, rawItems: any[]) {
    if (!this.ai) throw new Error('Gemini API key not configured');

    // 1. Identify Target Side from Query
    const targetSide = this.identifySide(query);

    // 2. Extract Parts from Query to validate (e.g., search for the part number in snippets)
    const queryPnMatch = query.match(/[A-Z0-9]{5,}/i);
    const targetPn = queryPnMatch ? queryPnMatch[0].toUpperCase() : '';

    // 3. Filter and Score Items
    const filteredItems = rawItems.filter(item => {
      // Filter by Side
      const itemSide = this.identifySide(item.title + ' ' + item.snippet);
      if (targetSide !== 'neutral' && itemSide !== 'neutral' && itemSide !== targetSide) {
        return false; // Skip opposite side
      }

      // Filter by obvious Part Number mismatch (e.g. 52128148 vs 52128149)
      // If snippet mentions a DIFFERENT number that looks like a Part Number, and not our target
      const otherPns = (item.title + ' ' + item.snippet).match(/[A-Z0-9]{5,}/gi) as string[] || [];
      const hasMismatch = otherPns.some(pn => {
        const cleanPn = pn.toUpperCase();
        return cleanPn !== targetPn && this.isSimilarPnPattern(cleanPn, targetPn) && !this.isCommonNoise(cleanPn);
      });

      if (hasMismatch && targetPn) {
        item.lowConfidence = true; // Mark instead of discard to give AI context
      }

      return true;
    });

    const snippetsText = filteredItems
      .map((it, idx) => {
        const p = it.price ? Number(it.price) : 0;
        return `[${idx + 1}]${it.lowConfidence ? ' [BAIXA CONFIANÇA]' : ''} Titulo: ${it.title} | ${it.snippet} | Preço: R$ ${!isNaN(p) ? p.toFixed(2) : '0.00'}`;
      })
      .join('\n');

    const prompt = `
      Você é um especialista em catálogo automotivo e análise de dados SERP.
      Higienize os resultados de busca para a query: "${query}".

      Entradas fornecidas (Snippets):
      ${snippetsText}

      OBSERVAÇÃO CRÍTICA:
      - Analise os preços nos snippets acima.
      - Se a maioria for R$ 0.00 ou se não houver informações confiáveis de preço para PEÇAS NOVAS, **USE A SUA FERRAMENTA DE BUSCA (Google Search)** para encontrar o preço médio de mercado atual no Brasil (Mercado Livre, lojas oficiais).
      - Não invente preços. Se buscar, baseie-se em ofertas reais encontradas.

      REQUISITOS DE SAÍDA (JSON ESTRITO):
      1. prices: { min: number, max: number, avg: number } (Apenas peça nova, ignore usados).
      2. titles: [string] (Máximo 5 títulos padronizados no formato "[TipoPeça] [Posição] [Abrev.Lado] [Modelo] [AnoInicial]-[AnoFinal se disponível]". Regras OBRIGATÓRIAS: (a) NÃO inclua marca/montadora (GM, Chevrolet, Fiat, etc.); (b) NÃO inclua o part number; (c) NÃO inclua "Novo", "Usado", "Original", "Genuíno", "Lado Esquerdo", "Lado Direito" no título; (d) Remova hífens de palavras compostas: "Parachoque" não "Para-choque", "Parabrisas" não "Para-brisa"; (e) Inclua a faixa de anos se disponível; (f) Lado deve vir ANTES do modelo como abreviação: use "Esq." para esquerdo e "Dir." para direito — nunca a forma completa. Exemplos corretos: "Parachoque Dianteiro Equinox 2018-2021", "Amortecedor Dianteiro Esq. Corolla 2019-2023", "Paralama Dianteiro Dir. Vectra 2006-2012". Exemplos ERRADOS: "Para-choque Dianteiro GM Equinox 84385252 Novo", "Amortecedor Dianteiro Lado Esquerdo Chevrolet", "Amortecedor Dianteiro Esquerdo Corolla").
      3. vehicles: [{ brand: string, model: string, startYear: number, endYear: number }] (Separe montadora de modelo. brand = apenas a montadora ("Chevrolet", "Fiat", "Toyota"). model = apenas o nome do modelo ("Equinox", "Strada", "Corolla"). Quebre faixas: "2018 a 2021" → startYear: 2018, endYear: 2021. Não inclua motorização no model.).
      4. fiscal: { ncm: string, origin: string } (Extraia se mencionado).
      5. dimensions: { weight: number, length: number, width: number, height: number } (Capture "X kg", "X mm", etc).
      6. attributes: [{ key: string, value: string }] (Atributos técnicos do produto: material, posição de montagem, tipo, diâmetro, lado, cor, acabamento, etc. Extraia do contexto dos snippets. Máximo 15 atributos relevantes. NÃO inclua atributos que já são campos dedicados do produto: marca/brand, condição/condition, número da peça/part number, garantia/warranty, peso/weight, dimensões/dimensions, NCM, origem/origin, preço/price, título/title, descrição/description.).
      7. description: string (Descrição completa do produto em português brasileiro, adequada para anúncios em marketplaces. Mínimo 3 frases, máximo 8 frases. Destaque compatibilidade, material e benefícios.).
      8. details: string (Detalhes técnicos adicionais em português, como especificações de instalação, observações de uso, informações de garantia, se disponíveis nos snippets. Máximo 3 frases.).
      9. oemCodes: [string] (Códigos OEM, cross-reference e part numbers alternativos encontrados nos snippets. Extraia números de peça de outros fabricantes, códigos equivalentes, referências originais. NÃO inclua o part number principal da query. Máximo 10 códigos.).
      10. categoryPath: string (Caminho de categoria mais adequado para esta peça em um catálogo de autopeças brasileiro. Use o formato "Nível 1 > Nível 2 > Nível 3". Exemplos: "Freios > Pastilhas de Freio", "Suspensão > Amortecedores", "Motor > Filtros > Filtro de Óleo", "Elétrica > Baterias". Seja específico e use terminologia técnica do setor automotivo.).

      FORMATO JSON:
      {
        "prices": { "min": 0, "max": 0, "avg": 0 },
        "titles": [],
        "vehicles": [{ "brand": "", "model": "", "startYear": 0, "endYear": 0 }],
        "fiscal": { "ncm": "", "origin": "" },
        "dimensions": { "weight": 0, "length": 0, "width": 0, "height": 0 },
        "attributes": [],
        "description": "",
        "details": "",
        "oemCodes": [],
        "categoryPath": ""
      }
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: { parts: [{ text: prompt }] },
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const candidateText = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
      const rawText = (response as any)?.text ?? candidateText ?? '';

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : rawText;

      const parsed = JSON.parse(jsonString);

      // Inject detected side as attribute if not already present
      if (targetSide !== 'neutral') {
        const sideValue = targetSide === 'left' ? 'Esquerdo' : 'Direito';
        const hasPosition = parsed.attributes?.some((a: any) =>
          a.key?.toLowerCase().includes('posição') || a.key?.toLowerCase().includes('lado')
        );
        if (!hasPosition) {
          parsed.attributes = parsed.attributes || [];
          parsed.attributes.push({ key: 'Posição', value: sideValue });
        }
      }

      return parsed;
    } catch (error) {
      console.error('Error sanitizing discovery data:', error);
      return {
        prices: { min: 0, max: 0, avg: 0 },
        titles: rawItems.slice(0, 5).map(it => it.title),
        vehicles: [],
        fiscal: { ncm: "", origin: "" },
        dimensions: { weight: 0, length: 0, width: 0, height: 0 },
        attributes: [],
        description: "",
        details: "",
        oemCodes: [],
        categoryPath: "",
      };
    }
  }

  /**
   * Returns the IDs (or permalinks) of items that pass the same side/PN relevance
   * filters used inside sanitizeDiscoveryData. Items that are side-mismatched or
   * have a conflicting part-number pattern are excluded. Use this to correlate
   * which scraper results are trustworthy before using their assets (e.g. images).
   */
  filterItemsByRelevance(query: string, rawItems: any[]): string[] {
    const targetSide = this.identifySide(query);
    const queryPnMatch = query.match(/[A-Z0-9]{5,}/i);
    const targetPn = queryPnMatch ? queryPnMatch[0].toUpperCase() : '';

    return rawItems
      .filter(item => {
        const text = `${item.title ?? ''} ${item.snippet ?? ''}`;

        // Drop side-mismatched items
        const itemSide = this.identifySide(text);
        if (targetSide !== 'neutral' && itemSide !== 'neutral' && itemSide !== targetSide) {
          return false;
        }

        // Drop items with a conflicting (similar but different) part number
        if (targetPn) {
          const otherPns: string[] = text.match(/[A-Z0-9]{5,}/gi) ?? [];
          const hasMismatch = otherPns.some(pn => {
            const clean = pn.toUpperCase();
            return clean !== targetPn && this.isSimilarPnPattern(clean, targetPn) && !this.isCommonNoise(clean);
          });
          if (hasMismatch) return false;
        }

        return true;
      })
      .map(item => (item.id ?? item.permalink ?? '') as string)
      .filter(Boolean);
  }

  private identifySide(text: string): 'left' | 'right' | 'neutral' {
    const t = text.toLowerCase();
    const leftKeys = ['esquerdo', 'esq', 'ee', 'lh', 'motorista', 'lado esquerdo'];
    const rightKeys = ['direito', 'dir', 'ed', 'rh', 'carona', 'passageiro', 'lado direito'];

    const isLeft = leftKeys.some(k => t.includes(k));
    const isRight = rightKeys.some(k => t.includes(k));

    if (isLeft && !isRight) return 'left';
    if (isRight && !isLeft) return 'right';
    return 'neutral';
  }

  private isSimilarPnPattern(pn1: string, pn2: string): boolean {
    if (pn1.length !== pn2.length) return false;
    // Se mudam apenas 1 ou 2 caracteres no final, é muito provável que seja o lado oposto ou modelo vizinho
    let diffs = 0;
    for (let i = 0; i < pn1.length; i++) {
      if (pn1[i] !== pn2[i]) diffs++;
    }
    return diffs <= 2;
  }

  private isCommonNoise(pn: string): boolean {
    const noise = ['SEDAN', 'HATCH', 'NCM', 'ORIGEM', 'CNPJ', 'BRASIL'];
    return noise.includes(pn.toUpperCase());
  }
}