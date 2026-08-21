import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddBoxProductDto {
  @ApiProperty({ description: 'ID do produto' })
  @IsNotEmpty()
  @IsString()
  productId: string;
}
