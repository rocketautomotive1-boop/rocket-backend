
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { GarageService } from '../garage/services/garage.service';
import { IntentExtractionService } from './intent-extraction.service';
import { AiChatSessionService } from './ai-chat-session.service';

export interface VirtualClerkNavigation {
    path: '/search';
    query: { q: string[]; vehicleId?: string; vehicleLabel?: string };
}

export interface VirtualClerkResponse {
    text: string;
    products: any[];
    navigateTo: VirtualClerkNavigation | null;
}

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);
    private genAI: any; // Using any to bypass potential type mismatch with @google/genai vs @google/generative-ai
    private model: any;

    constructor(
        private readonly configService: ConfigService,
        private readonly garageService: GarageService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
        private readonly intentExtraction: IntentExtractionService,
        private readonly chatSession: AiChatSessionService,
    ) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            // Initialize Gemini
            // Note: The package @google/genai might have a different initialization than @google/generative-ai
            // Adapting to standard Google Generative AI usage if the package allows or standard one is installed
            // If @google/genai is the new valid one, we use it. 
            // Assuming @google/generative-ai API surface for "GoogleGenerativeAI" class construction.
            try {
                const { GoogleGenerativeAI } = require("@google/generative-ai");
                this.genAI = new GoogleGenerativeAI(apiKey);
                this.model = this.genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
            } catch (e) {
                this.logger.warn("Could not load @google/generative-ai, trying @google/genai or failing gracefully.");
            }
        }
    }

    /**
     * Orquestrador magro: pergunta a IntentExtractionService se a mensagem é uma busca de
     * peça (com veículo já injetado no prompt, quando houver). Quando for, extrai os termos
     * (um por item recomendado/confirmado) e devolve navigateTo para a página /search, que
     * faz a busca de verdade via Atlas Search — o Balconista nunca busca produto diretamente.
     * Quando a IA responde só texto, mantém o comportamento conversacional de sempre.
     */
    async virtualClerk(
        userId: string,
        question: string,
        image?: string,
        clientVehicle?: { vehicleId?: string; vehicleLabel?: string },
        sessionId?: string,
    ): Promise<VirtualClerkResponse> {
        this.logger.log(`Virtual Clerk received question from user ${userId}: ${question} (Image present: ${!!image})`);

        // O veículo ativo mora no GarageContext do frontend (localStorage), que funciona
        // tanto logado quanto anônimo — por isso o cliente manda vehicleId/vehicleLabel
        // direto no payload e isso tem prioridade. garageService.list(userId) é só fallback
        // para chamadas antigas que não mandam o veículo explicitamente (e não existe pra
        // usuários anônimos, já que não há userId).
        let activeVehicleLabel: string | null = clientVehicle?.vehicleLabel ?? null;
        let activeVehicleId: string | null = clientVehicle?.vehicleId ?? null;

        if (!activeVehicleId && userId) {
            const vehicles = await this.garageService.list(userId);
            const activeVehicle = vehicles.find(v => v.active);
            if (activeVehicle) {
                activeVehicleLabel = activeVehicle.label;
                activeVehicleId = activeVehicle.vehicleId;
            }
        }

        const history = sessionId ? await this.chatSession.getRecentTurns(sessionId) : [];
        const intent = await this.intentExtraction.extract({
            question,
            image,
            vehicleLabel: activeVehicleLabel,
            history,
        });

        if (sessionId) {
            await this.chatSession.appendTurns(
                sessionId,
                [
                    { role: 'user', text: question, timestamp: new Date() },
                    {
                        role: 'model',
                        text: intent.conversationalText,
                        ...(intent.functionCall ? { functionCall: intent.functionCall } : {}),
                        timestamp: new Date(),
                    },
                ],
                { userId: userId || undefined, vehicleId: activeVehicleId ?? undefined },
            );
        }

        if (!intent.isProductQuery) {
            return { text: intent.conversationalText, products: [], navigateTo: null };
        }

        // A busca de verdade (Atlas Search, paginação, filtros) acontece na página /search —
        // o Balconista só extrai os termos; um por item recomendado/confirmado (ex: óleo +
        // filtro de óleo), cada um vira sua própria seção de resultados lá.
        const searchTerms = intent.items
            .map((item) => {
                const hasCode = item.codigo && item.codigo.toUpperCase() !== 'N/A';
                return hasCode ? item.codigo! : (item.termo ?? '');
            })
            .filter((term): term is string => !!term);

        if (searchTerms.length === 0) {
            return { text: 'Não consegui identificar a peça. Pode descrever com mais detalhes?', products: [], navigateTo: null };
        }

        return {
            text: intent.conversationalText,
            products: [],
            navigateTo: {
                path: '/search',
                query: {
                    q: searchTerms,
                    ...(activeVehicleId ? { vehicleId: activeVehicleId } : {}),
                    ...(activeVehicleLabel ? { vehicleLabel: activeVehicleLabel } : {}),
                },
            },
        };
    }
    async suggestQuestionAnswer(
        question: string,
        product: any,
        compatibilities?: any[],
    ): Promise<string> {
        if (!this.model) {
            throw new Error('Gemini AI not initialized (check API Key)');
        }

        const attrs = (product.attributes || [])
            .map((a: any) => `- ${a.name}: ${a.value}`)
            .join('\n');

        const compList = (compatibilities || [])
            .slice(0, 20)
            .map((c: any) => `${c.brand} ${c.model} ${c.year || ''} ${c.engine || ''}`.trim())
            .join(', ');

        const listingPrice = product.productTitles
            ?.find((pt: any) => pt.marketplaceData?.price)
            ?.marketplaceData?.price;

        const prompt = `
Você é um vendedor profissional de autopeças respondendo uma pergunta de comprador no Mercado Livre.

PERGUNTA DO COMPRADOR:
"${question}"

DADOS DO PRODUTO:
- Nome: ${product.name || 'N/A'}
- Código (Part Number): ${product.partNumber || 'N/A'}
- Código de Barras: ${product.barcode || 'N/A'}
- Descrição: ${product.description || 'N/A'}
- Detalhes Técnicos: ${product.details || 'N/A'}
- Condição: ${product.condition || 'N/A'}
- Garantia: ${product.warranty?.months ? product.warranty.months + ' meses' : 'N/A'}
- Estoque: ${product._id ? (await this.stockQuery.getProductStock(String(product._id))).onHand : 'N/A'} unidades
${listingPrice ? `- Preço: R$ ${listingPrice}` : ''}
${attrs ? `\nATRIBUTOS:\n${attrs}` : ''}
${compList ? `\nVEÍCULOS COMPATÍVEIS: ${compList}` : ''}

REGRAS:
1. Responda em português brasileiro, tom profissional e cordial.
2. MÁXIMO 350 caracteres (limite do Mercado Livre). Seja conciso.
3. Seja FACTUAL — use APENAS informações presentes nos dados do produto acima.
4. Se os dados não forem suficientes para responder com certeza, diga honestamente.
5. Nunca invente especificações, compatibilidades ou garantias que não estejam nos dados.
6. Não use saudações longas. Vá direto ao ponto.
7. Retorne APENAS o texto da resposta, sem aspas ou formatação extra.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();
            // Enforce 350 char limit
            return text.length > 350 ? text.substring(0, 347) + '...' : text;
        } catch (error) {
            this.logger.error(`Error suggesting question answer: ${error.message}`, error.stack);
            throw new Error('Failed to generate answer suggestion via AI');
        }
    }

    async suggestCategoryMetadata(tree: string[]): Promise<any> {
        if (!this.model) {
            throw new Error("Gemini AI not initialized (check API Key)");
        }

        const categoryPath = tree.join(" > ");

        const prompt = `
        Analise a categoria de peças automotivas: "${categoryPath}".
        
        Gere uma sugestão de metadados para melhorar a navegação do usuário e, se necessário, sugira uma árvore de categorias mais padronizada (padrão de mercado como Mercado Livre ou Google Shopping).
        Retorne APENAS um JSON válido com a seguinte estrutura (sem markdown):
        {
            "synonyms": ["sinônimo 1", "..."],
            "examples": ["Exemplo 1", "..."],
            "usageGuide": "Uma frase curta e direta explicando para que serve esta categoria e o que ela contém, ajudando o usuário a diferenciar de categorias similares.",
            "suggestedTree": ["Raiz", "...", "Categoria Final"],
            "relevance": 85
        }

        Regras:
        - "synonyms": Termos que usuários podem pesquisar para encontrar esta categoria.
        - "examples": itens físicos concretos que pertencem a esta categoria.
        - "usageGuide": Texto explicativo útil. Ex: "Use para pastilhas e discos. Para sensores, veja Freio > Eletrônica."
        - "suggestedTree": Sugestão de correção da árvore hierárquica para se adequar a padrões de mercado. A árvore pode ter QUALQUER profundidade (2, 3, 4 ou mais níveis), conforme necessário para a melhor organização. Se a árvore atual ("${categoryPath}") já estiver ótima, retorne ela mesma.
        - "relevance": Um número inteiro de 0 a 100 indicando a popularidade/importância de mercado desta categoria (100 = muito popular/essencial, 0 = muito específica/rara).
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Clean markdown code blocks if present
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

            return JSON.parse(cleanText);
        } catch (error) {
            this.logger.error(`Error suggesting category metadata: ${error.message}`, error.stack);
            throw new Error("Failed to generate suggestions via AI");
        }
    }

    async rankCategoriesForProduct(
        categories: Array<{ id: any; name: string; slug: string; examples?: string[]; synonyms?: string[]; usageGuide?: string }>,
        productContext: { name?: string; partNumber?: string; description?: string }
    ): Promise<any[]> {
        if (!this.model) {
            throw new Error("Gemini AI not initialized (check API Key)");
        }

        const productInfo = `
Produto:
- Nome: ${productContext.name || 'N/A'}
- Código: ${productContext.partNumber || 'N/A'}
- Descrição: ${productContext.description || 'N/A'}
        `.trim();

        const categoriesInfo = categories.map((cat, idx) => `
${idx + 1}. ${cat.name}
   - Exemplos: ${cat.examples?.join(', ') || 'N/A'}
   - Sinônimos: ${cat.synonyms?.join(', ') || 'N/A'}
   - Guia: ${cat.usageGuide || 'N/A'}
        `).join('\n');

        const prompt = `
Você é um especialista em categorização de peças automotivas.

${productInfo}

CATEGORIAS DISPONÍVEIS (do banco de dados):
${categoriesInfo}

TAREFA: Analise o produto e ORDENE as categorias da MAIS RELEVANTE para a MENOS RELEVANTE.
Retorne APENAS um JSON array com os IDs das categorias ordenados (sem markdown):

["id_mais_relevante", "id_segunda_mais_relevante", ...]

IMPORTANTE: Use EXATAMENTE os mesmos IDs fornecidos acima. Retorne TODOS os IDs, apenas reordenados por relevância.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Clean markdown code blocks if present
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const rankedIds = JSON.parse(cleanText);

            // Reorder categories based on AI ranking
            const categoryMap = new Map(categories.map(c => [String(c.id), c]));
            const ranked = rankedIds
                .map((id: any) => categoryMap.get(String(id)))
                .filter(Boolean);

            // Add any missing categories at the end (safety)
            const rankedIdSet = new Set(rankedIds.map(String));
            const missing = categories.filter(c => !rankedIdSet.has(String(c.id)));

            return [...ranked, ...missing];
        } catch (error) {
            this.logger.error(`Error ranking categories: ${error.message}`, error.stack);
            // Return original order on error
            return categories;
        }
    }

    async suggestChildCategories(categoryPath: string, searchRefinement?: string): Promise<any[]> {
        if (!this.model) {
            throw new Error("Gemini AI not initialized (check API Key)");
        }

        const refinementContext = searchRefinement
            ? `\n\nCONTEXTO ADICIONAL PARA REFINAMENTO:\n"${searchRefinement}"\n\nConsidere este contexto ao sugerir as subcategorias, priorizando aquelas mais relevantes para este tipo específico de produto ou necessidade.`
            : '';

        const prompt = `
Você é um especialista em categorização de peças automotivas.

CATEGORIA PAI: "${categoryPath}"${refinementContext}

TAREFA: Sugira as principais SUBCATEGORIAS que deveriam existir dentro desta categoria.

Retorne APENAS um JSON array (sem markdown) com 5-10 subcategorias relevantes, ORDENADAS por relevância (mais importante primeiro):

[
  {
    "name": "Nome da Subcategoria",
    "examples": ["Exemplo 1", "Exemplo 2", "Exemplo 3"],
    "synonyms": ["Sinônimo 1", "Sinônimo 2"],
    "usageGuide": "Breve explicação do que pertence a esta subcategoria",
    "relevance": 95,
    "order": 1
  }
]

REGRAS CRÍTICAS:
- Cada categoria deve ser ATÔMICA e ESPECÍFICA - UMA categoria para CADA tipo de peça
- NUNCA agrupe múltiplos tipos de peças em uma única categoria (ex: "Batentes e Amortecedores" está ERRADO)
- CORRETO: "Batentes" como uma categoria, "Amortecedores" como outra categoria separada
- Foque em subcategorias COMUNS e PRÁTICAS para uma loja de autopeças
- Use nomenclatura padrão do mercado (Mercado Livre, Google Shopping)
- Exemplos devem ser peças físicas concretas
- Sinônimos são termos alternativos que usuários podem buscar
- UsageGuide deve ajudar a diferenciar de categorias similares
- "relevance": Número de 0-100 indicando popularidade/importância (100 = muito popular)
- "order": Número sequencial (1, 2, 3...) para ordenação de exibição
- ORDENE as categorias da mais relevante/popular para a menos
- Cada categoria deve representar UM ÚNICO tipo de produto ou componente
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Clean markdown code blocks if present
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

            return JSON.parse(cleanText);
        } catch (error) {
            this.logger.error(`Error suggesting child categories: ${error.message}`, error.stack);
            throw new Error("Failed to generate child category suggestions via AI");
        }
    }

    async mapMarketplaceCategoryToInternal(
        marketplacePath: string,
        existingTreeContext: { name: string; path: string }[],
        domain: string = 'autopecas',
    ): Promise<{
        suggestedTree: string[];
        confidence: number;
        reasoning: string;
        alternatives?: string[][];
    }> {
        if (!this.model) {
            throw new Error("Gemini AI not initialized (check API Key)");
        }

        // Build context string from existing categories
        const contextLines = existingTreeContext
            .slice(0, 50) // Limit to avoid token overflow
            .map(cat => `- ${cat.path}`)
            .join('\n');

        // Itens gerais (saúde, beleza, alimentos, etc.) NÃO são autopeças — o prompt
        // não pode forçar a taxonomia automotiva (senão um suplemento vira "Outros
        // Acessórios"). Para general usamos um prompt GENÉRICO, fiel à categoria do ML.
        const prompt = domain === 'general'
            ? `
Você é um especialista em taxonomia de categorias de e-commerce (qualquer segmento:
saúde, beleza, alimentos, bebidas, casa, eletrônicos, etc.).

TAREFA: Mapear uma categoria do Mercado Livre para uma árvore de categorias interna,
PRESERVANDO o segmento/domínio real do produto (NÃO force em automotivo/peças).

CATEGORIA DO MERCADO LIVRE:
"${marketplacePath}"

CONTEXTO - CATEGORIAS EXISTENTES (exemplos, podem ser de outros segmentos):
${contextLines}

INSTRUÇÕES:
1. Crie a árvore hierárquica fiel ao significado da categoria do ML.
2. A raiz deve refletir o segmento real (ex.: "Saúde", "Beleza", "Alimentos", "Bebidas").
3. NUNCA classifique como peça/acessório automotivo se o produto não for automotivo.
4. Reutilize uma raiz existente SÓ se for do mesmo segmento; senão crie a raiz correta.
5. Padrão: ["Raiz", "Nível 2", "Nível 3", ...].

Retorne APENAS um JSON (sem markdown):
{
  "suggestedTree": ["Saúde", "Suplementos Alimentares", "Vitaminas e Minerais"],
  "confidence": 90,
  "reasoning": "Explicação breve",
  "alternatives": [["Saúde", "Vitaminas e Suplementos"]]
}

REGRAS:
- "suggestedTree": árvore (array de strings) fiel ao segmento do produto
- "confidence": 0-100
- "reasoning": justificativa (máx. 2 linhas)
- "alternatives": até 2 opções (opcional)
        `
            : `
Você é um especialista em categorização de peças automotivas.

TAREFA: Mapear uma categoria do Mercado Livre para a estrutura de categorias da Rocket.

CATEGORIA DO MERCADO LIVRE:
"${marketplacePath}"

CONTEXTO - CATEGORIAS EXISTENTES NA ROCKET (exemplos):
${contextLines}

INSTRUÇÕES:
1. Analise a categoria do Mercado Livre
2. Considere as categorias existentes na Rocket para manter consistência
3. Sugira a melhor árvore hierárquica equivalente na Rocket
4. A árvore deve seguir o padrão: ["Raiz", "Nível 2", "Nível 3", ...]
5. Priorize REUTILIZAR categorias existentes quando apropriado
6. Se necessário criar novas categorias, mantenha nomenclatura consistente

Retorne APENAS um JSON (sem markdown):
{
  "suggestedTree": ["Peças", "Motor", "Turbinas", "Conjuntos Rotativos"],
  "confidence": 85,
  "reasoning": "Explicação breve de por que esta é a melhor correspondência",
  "alternatives": [
    ["Peças", "Motor", "Turbocompressores"],
    ["Acessórios", "Performance", "Turbinas"]
  ]
}

REGRAS:
- "suggestedTree": Árvore hierárquica sugerida (array de strings)
- "confidence": 0-100, quão confiante você está neste mapeamento
- "reasoning": Justificativa da escolha (máximo 2 linhas)
- "alternatives": Até 2 opções alternativas (opcional)
- SEMPRE tente reutilizar categorias raiz existentes (Peças, Acessórios, etc.)
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleanText);
        } catch (error) {
            this.logger.error(`Error mapping marketplace category: ${error.message}`, error.stack);
            throw new Error("Failed to map marketplace category via AI");
        }
    }

    async translateAndAdaptSnippet(technicalText: string): Promise<string> {
        if (!this.model) {
            this.logger.warn("Gemini AI not initialized. Returning original snippet.");
            return technicalText;
        }

        const prompt = `
Traduza e adapte a seguinte descrição de uma peça ou produto automotivo, focando no jargão correto do mercado brasileiro:
"${technicalText}"

Retorne APENAS o texto traduzido e adaptado ao mercado nacional e sem incluir comentários extras.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            this.logger.error(`Error translating snippet: ${error.message}`, error.stack);
            return technicalText; // Fallback
        }
    }
}
