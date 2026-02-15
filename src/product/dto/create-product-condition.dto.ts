import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateProductConditionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;
} 