import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class AddBoxItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  conditionId: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  quantity: number;
} 