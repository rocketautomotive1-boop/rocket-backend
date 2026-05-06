import { Injectable } from '@nestjs/common';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';

@Injectable()
export class VehicleAiPromptBuilder {
  build(input: Record<string, any>): { systemInstruction: string; userPrompt: string } {
    const systemInstruction = [
      'Voce e um especialista em catalogo automotivo brasileiro.',
      'Retorne SOMENTE JSON valido.',
      'Preencha campos com melhor inferencia possivel e adicione warnings quando houver incerteza.',
      `aiPromptVersion=${VEHICLE_CONSTANTS.AI_PROMPT_VERSION}`,
    ].join(' ');

    const rawDataStr = input?.rawData ? `\nRAW_DATA: ${JSON.stringify(input.rawData).slice(0, 3000)}` : '';

    const userPrompt = [
      'Extraia e normalize os campos do veiculo abaixo.',
      'Campos esperados: make, model, version, productionYears[], bodyType, platform, generation, facelift,',
      'engine{displacement,family,aspiration,fuelType,valvetrain,powerCvGasoline,powerCvEthanol,torqueNm},',
      'transmission[], fipe{code,description,reference,value}, aliases[], tags[], confidence, warnings[], missingFields[].',
      `TITLE: ${input?.title ?? 'N/A'}`,
      `DESCRIPTION: ${input?.description ?? 'N/A'}`,
      `MAKE: ${input?.make ?? 'N/A'}`,
      `MODEL: ${input?.model ?? 'N/A'}`,
      `VERSION: ${input?.version ?? 'N/A'}`,
      `ENGINE: ${input?.engine ?? 'N/A'}`,
      `YEARS: ${Array.isArray(input?.years) ? input.years.join(',') : 'N/A'}`,
      `SOURCE: ${input?.source ?? 'N/A'}`,
      rawDataStr,
    ].join('\n');

    return { systemInstruction, userPrompt };
  }
}
