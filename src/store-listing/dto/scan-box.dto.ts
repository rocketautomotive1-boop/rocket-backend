import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanBoxDto {
  @ApiProperty({ description: 'Conteúdo lido do QR Code do box' })
  @IsNotEmpty()
  @IsString()
  qr: string;

  @ApiProperty({ description: 'ID da alocação onde o box deve ficar' })
  @IsNotEmpty()
  @IsString()
  allocationId: string;
}
