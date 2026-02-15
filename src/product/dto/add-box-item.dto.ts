import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class AddBoxItemDto {
  @IsNumber()
  @IsNotEmpty()
  productId: number;

  @IsNumber()
  @IsNotEmpty()
  conditionId: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  quantity: number;
} 