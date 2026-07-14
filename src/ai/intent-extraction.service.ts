import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IntentItem {
  termo?: string;
  codigo?: string;
}

export interface IntentExtractionResult {
  isProductQuery: boolean;
  items: IntentItem[];
  conversationalText: string;
  functionCall?: { name: string; args: any };
}

interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
  functionCall?: { name: string; args: any };
}

interface ExtractOptions {
  question: string;
  image?: string;
  vehicleLabel?: string | null;
  history?: HistoryTurn[];
}

/**
 * Isola a chamada de IA (Gemini + function-calling) que decide se uma mensagem do
 * Balconista é uma busca de peça ou uma pergunta conversacional — extraída de
 * AiService.virtualClerk para que a decisão de intent seja testável e reutilizável
 * sem acoplar à orquestração de busca/resposta.
 */
@Injectable()
export class IntentExtractionService {
  private readonly logger = new Logger(IntentExtractionService.name);
  private genAI: any;
  private model: any;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
      } catch (e) {
        this.logger.warn('Could not load @google/generative-ai for intent extraction.');
      }
    }
  }

  async extract(options: ExtractOptions): Promise<IntentExtractionResult> {
    const { question, image, vehicleLabel, history = [] } = options;

    if (!this.model) {
      return { isProductQuery: false, items: [], conversationalText: 'Assistente indisponível no momento.' };
    }

    const tools = [
      {
        functionDeclarations: [
          {
            name: 'processar_lista_compras',
            description: 'Extrai códigos de peças e nomes de produtos de uma lista ou frase para buscar no catálogo.',
            parameters: {
              type: 'OBJECT',
              properties: {
                itens: {
                  type: 'ARRAY',
                  description: 'Lista de objetos contendo os códigos e nomes identificados',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      codigo: { type: 'STRING', description: 'O SKU ou código do fabricante (ex: btc08206)' },
                      termo: { type: 'STRING', description: 'Nome da peça (ex: Amortecedor)' },
                    },
                  },
                },
              },
              required: ['itens'],
            },
          },
        ],
      },
    ];

    const vehicleContext = vehicleLabel
      ? `VEÍCULO NA GARAGEM: ${vehicleLabel}`
      : 'Nenhum veículo identificado na garagem.';

    const systemInstruction = `
        Você é o "Balconista Digital", o Consultor Técnico da Rocket Auto Peças.

        PROTOCOLO DE VISÃO (IMPORTANTE):
        1. SE RECEBER UMA IMAGEM: Você É OBRIGADO a chamar a função "processar_lista_compras".
        2. Se o cliente PEDIR ou CONFIRMAR que quer ver/comprar uma PEÇA (nome, código, sintoma claramente
           ligado a uma peça, ou uma confirmação tipo "sim"/"quero ver" após você ter recomendado algo),
           chame "processar_lista_compras". Se a recomendação envolver mais de um item (ex: óleo e filtro
           de óleo), chame a função com um item por peça. Se não souber o veículo, chame a função APENAS
           com o NOME DA PEÇA (ex: "Bieleta") — a busca se encarrega do resto.
        3. Se a pergunta for uma dúvida técnica/genérica (ex: "qual óleo devo usar", "qual a revisão"),
           responda APENAS com texto explicativo — NÃO chame a função nesse primeiro momento. Só chame a
           função se o cliente confirmar/pedir para ver os produtos em uma mensagem seguinte.

        REGRA CRÍTICA DE CONTEXTO:
        Se o CONTEXTO DO CLIENTE abaixo já informa o veículo, você JÁ SABE modelo, motorização e ano —
        está PROIBIDO perguntar "qual é o modelo/motorização do seu carro?" de novo. Responda direto com
        base no veículo informado (ex: especificação de óleo, revisão, item técnico daquele modelo
        específico). Só pergunte o veículo se o CONTEXTO DO CLIENTE disser que nenhum foi identificado.

        CONTEXTO DO CLIENTE:
        ${vehicleContext}
      `;

    const priorTurns = history.map((turn) => ({
      role: turn.role,
      parts: turn.functionCall
        ? [{ functionCall: turn.functionCall }]
        : [{ text: turn.text }],
    }));

    const chatSession = this.model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemInstruction }] },
        { role: 'model', parts: [{ text: 'Entendido. Vou identificar peças e chamar a busca quando fizer sentido.' }] },
        ...priorTurns,
      ],
      tools,
    });

    const msgParts: any[] = [];
    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      msgParts.push({ text: question || 'Analise esta imagem de peça automotiva. Identifique a peça, códigos e sugira a reposição.' });
      msgParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
    } else {
      msgParts.push({ text: question });
    }

    try {
      const result = await chatSession.sendMessage(msgParts);
      const response = await result.response;
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0 && functionCalls[0].name === 'processar_lista_compras') {
        const args = functionCalls[0].args as any;
        const items: IntentItem[] = (args.itens || []).filter((i: IntentItem) => i.termo || i.codigo);
        let conversationalText = '';
        try {
          conversationalText = response.text() || '';
        } catch {
          // Gemini não retorna texto quando a resposta é só a function call — ok, fica vazio.
        }
        return {
          isProductQuery: items.length > 0,
          items,
          conversationalText,
          functionCall: { name: functionCalls[0].name, args },
        };
      }

      return { isProductQuery: false, items: [], conversationalText: response.text() };
    } catch (error) {
      this.logger.error(`Error extracting intent: ${error.message}`, error.stack);
      return {
        isProductQuery: false,
        items: [],
        conversationalText: 'Desculpe, estou com dificuldades para processar sua pergunta agora. Pode tentar novamente?',
      };
    }
  }
}
