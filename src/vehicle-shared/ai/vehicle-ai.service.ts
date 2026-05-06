import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { VehicleAiPromptBuilder } from './vehicle-ai-prompt.builder';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import { VehicleAiOutput } from '../types/vehicle.types';
import { tryParseJson } from '../utils/string.util';
import { VehicleAiParseException } from '../exceptions/vehicle.exceptions';

@Injectable()
export class VehicleAiService {
  private readonly logger = new Logger(VehicleAiService.name);
  private modelName = 'gemini-3-flash-preview';
  private ai: GoogleGenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly promptBuilder: VehicleAiPromptBuilder,
  ) {
    this.init();
  }

  private init() {
    const apiKey =
      this.configService.get<string>('GEMINI_API_KEY') ||
      this.configService.get<string>('EXPO_PUBLIC_GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not configured. AI enrichment will fail.');
      return;
    }

    try {
      this.ai = new GoogleGenAI({ apiKey });
      this.modelName =
        this.configService.get<string>('GEMINI_MODEL') || this.modelName;
    } catch (err) {
      this.logger.error(`Failed to initialize Gemini client: ${err?.message}`);
    }
  }

  async enrich(input: Record<string, any>): Promise<{
    output: VehicleAiOutput;
    rawResponse: string;
    model: string;
  }> {
    if (!this.ai) {
      throw new Error('Gemini model is not initialized');
    }

    const { systemInstruction, userPrompt } = this.promptBuilder.build(input);

    let lastError: any;
    for (let attempt = 1; attempt <= VEHICLE_CONSTANTS.MAX_RETRY_COUNT; attempt++) {
      try {
        const result = await this.ai.models.generateContent({
          model: this.modelName,
          contents: { parts: [{ text: userPrompt }] },
          config: { systemInstruction },
        });

        const candidateText = (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
        const rawText = (result as any)?.text ?? candidateText ?? '';
        const parsed = tryParseJson(rawText);

        if (!parsed) {
          throw new VehicleAiParseException(rawText);
        }

        return {
          output: parsed as VehicleAiOutput,
          rawResponse: rawText,
          model: this.modelName,
        };
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `Gemini enrich failed attempt ${attempt}/${VEHICLE_CONSTANTS.MAX_RETRY_COUNT}: ${err?.message}`,
        );
      }
    }

    throw lastError;
  }
}
