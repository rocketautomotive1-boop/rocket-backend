import {
  Controller, Post, Body, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AiImageService } from './ai-image.service';
import { GenerateImagesDto } from './dto/generate-images.dto';
import { ImageSize } from './openai-image.client';

@ApiTags('AI Images')
@Controller('ai/images')
export class AiImageController {
  constructor(private readonly aiImageService: AiImageService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Gera imagens de produto por IA e salva no repositório' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('referenceImage'))
  async generate(@Body() body: GenerateImagesDto, @UploadedFile() referenceImage?: any) {
    const reference = referenceImage
      ? {
          buffer: referenceImage.buffer,
          fileName: referenceImage.originalname || 'reference.png',
          mimeType: referenceImage.mimetype || 'image/png',
        }
      : undefined;

    const images = await this.aiImageService.generate({
      productId: body.productId,
      instruction: body.instruction ?? '',
      count: body.count ?? 3,
      size: (body.size ?? '1024x1024') as ImageSize,
      reference,
    });
    return { images };
  }
}
