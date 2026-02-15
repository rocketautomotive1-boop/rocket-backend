import { PartialType } from '@nestjs/swagger';
import { CreateProductNCMDto } from './create-product-ncm.dto';

export class UpdateProductNCMDto extends PartialType(CreateProductNCMDto) {}