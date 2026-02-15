import { IsNumber, IsNotEmpty, Min } from 'class-validator';

export class CreateBoxItemDto {
  @IsNumber()
  @IsNotEmpty()
  boxId: number;

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