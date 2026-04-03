import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateBoxItemDto {
  @IsString()
  @IsNotEmpty()
  boxId: string;

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