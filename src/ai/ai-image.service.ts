import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductRepository } from '../product/product.repository';
import { S3Service } from '../common/s3/s3.service';
import { ProcessedImageService } from '../processed-image/processed-image.service';
import { OpenAiImageClient, ImageSize } from './openai-image.client';
import { buildImagePrompt } from './ai-image.prompt';

export interface GenerateImagesInput {
  productId: string;
  instruction: string;
  count: number;
  size: ImageSize;
  reference?: { buffer: Buffer; fileName: string; mimeType: string };
}

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly openAiImageClient: OpenAiImageClient,
    private readonly s3Service: S3Service,
    private readonly processedImageService: ProcessedImageService,
  ) {}

  async generate(input: GenerateImagesInput) {
    const product: any = await this.productRepository.findByIdLean(input.productId);
    if (!product) {
      throw new NotFoundException(`Produto ${input.productId} não encontrado`);
    }

    const prompt = buildImagePrompt(product, input.instruction);
    const buffers = await this.openAiImageClient.generate({
      prompt,
      count: input.count,
      size: input.size,
      reference: input.reference,
    });

    const batchCode = `AI-${Date.now()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const batchNote =
      [product.partNumber, product.brand?.name].filter(Boolean).join(' ').trim() || null;

    const saved = [];
    for (let i = 0; i < buffers.length; i++) {
      const key = `repository/ai/${batchCode}/${i}.png`;
      const url = await this.s3Service.uploadFile(buffers[i], key, 'image/png', true);
      const doc = await this.processedImageService.saveProcessedImage({
        url,
        key,
        batchCode,
        batchNote,
        productId: input.productId,
        mimeType: 'image/png',
        source: 'ai',
      });
      saved.push(doc);
    }
    return saved;
  }
}
