import { PartialType } from '@nestjs/mapped-types';
import { CreateMovementItemDto } from './create-movement-item.dto';

export class UpdateMovementItemDto extends PartialType(CreateMovementItemDto) {} 