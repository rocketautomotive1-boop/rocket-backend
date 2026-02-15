import { IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssociateProductBoxItemDto {
  @ApiProperty({ description: 'ID do box', required: true })
  @IsNumber()
  boxId: number;

  @ApiProperty({ description: 'ID da condição do produto', required: true })
  @IsNumber()
  conditionId: number;

  @ApiProperty({ description: 'Quantidade do produto no box', required: true, minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}
