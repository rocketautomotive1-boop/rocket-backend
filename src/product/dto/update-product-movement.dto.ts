import { PartialType } from '@nestjs/swagger';
import { CreateProductMovementDto } from './create-product-movement.dto';

export class UpdateProductMovementDto extends PartialType(CreateProductMovementDto) {}

