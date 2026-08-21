import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkBoxAllocationDto {
  @ApiProperty({ description: 'ID da alocação de destino' })
  @IsNotEmpty()
  @IsString()
  allocationId: string;
}
