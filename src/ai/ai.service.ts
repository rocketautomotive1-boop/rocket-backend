
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SearchService } from '../search/search.service';
import { ProductRepository } from '../product/product.repository';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument, UserModel } from '../auth/schemas/user.schema';
import { VehicleDocument, VehicleModel } from '../customer/schemas/vehicle.schema';

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);
    private genAI: any; // Using any to bypass potential type mismatch with @google/genai vs @google/generative-ai
    private model: any;

    constructor(
        private readonly configService: ConfigService,
        @Inject(forwardRef(() => SearchService)) private readonly searchService: SearchService,
        @InjectModel(UserModel.name) private userModel: Model<UserDocument>,
        @InjectModel(VehicleModel.name) private vehicleModel: Model<VehicleDocument>,
        private readonly productRepository: ProductRepository,
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

    async virtualClerk(userId: string, question: string, image?: string): Promise<{ text: string, products: any[] }> {
        try {
            this.logger.log(`Virtual Clerk received question from user ${userId}: ${question} (Image present: ${!!image})`);

            // 1. Fetch User and Active Context
            let userContext = `Cliente não identificado.`;
            let vehicleContext = `Nenhum veículo identificado na garagem.`;
            let activeVehicle: any = null;

            if (userId) {
                const user = await this.userModel.findById(userId).populate('garage.vehicleId');
                if (user) {
                    userContext = `CLIENTE: ${user.name}`;
                    const primaryVehicleRef = user.garage?.find(v => v.isPrimary);
                    if (primaryVehicleRef && primaryVehicleRef.vehicleId) {
                        activeVehicle = primaryVehicleRef.vehicleId; // Populated
                        if (activeVehicle) {
                            vehicleContext = `VEÍCULO NA GARAGEM: ${activeVehicle.brand} ${activeVehicle.model} ${activeVehicle.year} ${activeVehicle.engine || ''} ${activeVehicle.version || ''}`;
                        }
                    }
                }
            }

            // 2. Define Tools (Multi-Item List Processing)
            const tools = [
                {
                    functionDeclarations: [
                        {
                            name: "processar_lista_compras",
                            description: "Extrai códigos de peças e nomes de produtos de uma lista ou frase para exibir no catálogo.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    itens: {
                                        type: "ARRAY",
                                        description: "Lista de objetos contendo os códigos e nomes identificados",
                                        items: {
                                            type: "OBJECT",
                                            properties: {
                                                codigo: { type: "STRING", description: "O SKU ou código do fabricante (ex: btc08206)" },
                                                termo: { type: "STRING", description: "Nome da peça (ex: Amortecedor)" }
                                            }
                                        }
                                    }
                                },
                                required: ["itens"]
                            }
                        }
                    ]
                }
            ];

            // 3. Construct Prompt (Orçamentista Proativo Persona)
            const systemInstruction = `
        Você é o "Rocket Man", o Consultor Técnico e Balconista da Rocket Auto Peças.
        
        PROTOCOLO DE VISÃO (IMPORTANTE):
        1. SE RECEBER UMA IMAGEM: Você É OBRIGADO a chamar a função "processar_lista_compras".
        2. NÃO responda apenas com texto descrevendo a peça. O cliente quer O LINK DO PRODUTO.
        3. Se não souber o veículo, chame a função APENAS com o NOME DA PEÇA (ex: "Bieleta"). A busca se encarrega do resto.
        4. NUNCA diga "já separei" se você não invocou "processar_lista_compras".
        
        MINDSET:
        1. Você É O ESPECIALISTA. Identifique a peça visualmente.
        2. AÇÃO: Identificou? -> processar_lista_compras({ itens: [{ termo: "Nome da Peça" }] }).
        3. Se houver código na imagem, use-o no campo "codigo".

        CONTEXTO DO CLIENTE:
        ${userContext}
        ${vehicleContext}

        REGRAS DE OURO:
        - IMAGEM = IDENTIFICAR + CHAMAR TOOL (processar_lista_compras).
        - SEMPRE execute a busca, mesmo genérica. Melhor mostrar peças de vários carros do que nenhuma.
      `;

            const chatSession = this.model.startChat({
                history: [
                    { role: "user", parts: [{ text: systemInstruction }] },
                    { role: "model", parts: [{ text: "Entendido. Estou pronto para atuar como Balconista Virtual da Rocket, processando listas e verificando a garagem." }] }
                ],
                tools: tools
            });

            // 4. Send Message (Multimodal support)
            let msgParts: any[] = [];

            // Vision Prompt Logic
            if (image) {
                // Strip header if present (e.g., "data:image/jpeg;base64,")
                const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

                msgParts.push({ text: question || "Analise esta imagem de peça automotiva. Identifique a peça, códigos e sugira a reposição." });
                msgParts.push({
                    inlineData: {
                        mimeType: "image/jpeg", // Assuming JPEG for simplicity, or detect from header
                        data: base64Data
                    }
                });
            } else {
                msgParts.push({ text: question });
            }

            const result = await chatSession.sendMessage(msgParts);
            const response = await result.response;
            const functionCalls = response.functionCalls();

            let productsFound: any[] = [];
            let finalResponseText = response.text();

            // 5. Handle Function Calls (Iterative Search)
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                if (call.name === "processar_lista_compras") {
                    const args = call.args as any;
                    this.logger.log(`Function args received: ${JSON.stringify(args)}`);
                    const itens = args.itens || [];
                    this.logger.log(`Processing list with ${itens.length} items`);

                    // Iterate and search for each item
                    for (const item of itens) {
                        let searchQuery = "";

                        const hasCode = item.codigo && item.codigo.toUpperCase() !== "N/A";

                        if (hasCode) {
                            searchQuery = item.codigo; // Priority to code
                        } else if (item.termo) {
                            searchQuery = item.termo;
                            // If generic term and we have a garage vehicle, append context for better relevance
                            // BUT only if the user didn't specify another car in the text (Hard to detect here, relying on AI warning text, 
                            // but for search accuracy, adding the garage vehicle is usually safe as a "suggestion")
                            // A better approach: The text response warns, but the search shows what "best fits" the user's likely intent or pure search.
                            // Let's stick to: Search for the term + Garage Vehicle if available to ensure we show compatible parts by default.
                            if (activeVehicle) {
                                searchQuery += ` ${activeVehicle.model} ${activeVehicle.year}`;
                            }
                        }

                        if (searchQuery) {
                            this.logger.log(`Searching item: ${searchQuery}`);
                            // Buscando produtos
                            const searchResult: any = await this.searchService.search(searchQuery);
                            const searchResults = searchResult.data || [];
                            // Take top 2 results for each item to build the "Counter"
                            productsFound.push(...searchResults.slice(0, 2));
                        }
                    }

                    // 6. Send Function Response back to Gemini
                    const functionResponse = {
                        functionResponse: {
                            name: "processar_lista_compras",
                            response: {
                                found_count: productsFound.length,
                                products_summary: productsFound.map(p => `${p.partNumber} (${p.brand?.name || 'Genérico'})`).join(", "),
                                status: "Produtos colocados no balcão virtual."
                            }
                        }
                    };

                    const finalResult = await chatSession.sendMessage([functionResponse]);
                    finalResponseText = (await finalResult.response).text();
                }
            }

            return {
                text: finalResponseText,
                products: productsFound
            };

        } catch (error) {
            this.logger.error(`Error in virtualClerk: ${error.message}`, error.stack);
            return {
                text: "Desculpe, estou com dificuldades para processar sua lista agora. Pode tentar novamente?",
                products: []
            };
        }
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
- Estoque: ${product._id ? await this.productRepository.calculateStock(String(product._id)) : 'N/A'} unidades
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
        existingTreeContext: { name: string; path: string }[]
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

        const prompt = `
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
