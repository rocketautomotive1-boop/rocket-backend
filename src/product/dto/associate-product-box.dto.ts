import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssociateProductBoxDto {
  @ApiProperty({ description: 'ID do box', required: false })
  @IsNumber()
  @IsOptional()
  boxId?: number;
}
