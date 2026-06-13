import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

const ALLOWED_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;
export type ImageSizeDto = (typeof ALLOWED_SIZES)[number];

/**
 * Payload de POST /ai/images/generate. Aceita JSON ou multipart/form-data — em
 * multipart os campos chegam como string, então usamos class-transformer (@Type)
 * para coerção. Validado pelo ValidationPipe global (transform + whitelist).
 */
export class GenerateImagesDto {
  @IsString()
  @IsNotEmpty({ message: 'productId é obrigatório' })
  productId: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'count deve ser inteiro' })
  @Min(1)
  @Max(4)
  count?: number;

  @IsOptional()
  @IsIn(ALLOWED_SIZES, { message: 'size inválido' })
  size?: ImageSizeDto;
}
