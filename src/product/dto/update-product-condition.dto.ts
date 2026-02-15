import { PartialType } from '@nestjs/mapped-types';
import { CreateProductConditionDto } from './create-product-condition.dto';

export class UpdateProductConditionDto extends PartialType(CreateProductConditionDto) {} 