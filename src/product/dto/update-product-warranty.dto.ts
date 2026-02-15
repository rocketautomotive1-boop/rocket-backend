import { PartialType } from '@nestjs/swagger';
import { CreateProductWarrantyDto } from './create-product-warranty.dto';

export class UpdateProductWarrantyDto extends PartialType(CreateProductWarrantyDto) {}