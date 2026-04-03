import { PartialType } from '@nestjs/swagger';
import { CreateProductAllocationDto } from './create-product-allocation.dto';

export class UpdateProductAllocationDto extends PartialType(CreateProductAllocationDto) { }