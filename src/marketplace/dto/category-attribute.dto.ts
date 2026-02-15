// src/marketplace/dto/category-attribute.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CategoryAttributeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  value_type: string;

  @ApiProperty({ required: false })
  values?: any[];

  @ApiProperty()
  required: boolean;
}