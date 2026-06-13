import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface GenerateParams {
  prompt: string;
  count: number;
  size: ImageSize;
  reference?: { buffer: Buffer; fileName: string; mimeType: string };
}

@Injectable()
export class OpenAiImageClient {
  private readonly logger = new Logger(OpenAiImageClient.name);
  private readonly client: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  /** Gera N imagens e devolve seus buffers PNG. */
  async generate(params: GenerateParams): Promise<Buffer[]> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Geração de imagens indisponível: OPENAI_API_KEY não configurada.',
      );
    }

    const response = params.reference
      ? await this.client.images.edit({
          model: 'gpt-image-1',
          image: await toFile(params.reference.buffer, params.reference.fileName, {
            type: params.reference.mimeType,
          }),
          prompt: params.prompt,
          n: params.count,
          size: params.size,
        })
      : await this.client.images.generate({
          model: 'gpt-image-1',
          prompt: params.prompt,
          n: params.count,
          size: params.size,
        });

    const data = response.data ?? [];
    return data
      .map((img) => img.b64_json)
      .filter((b64): b64 is string => !!b64)
      .map((b64) => Buffer.from(b64, 'base64'));
  }
}
