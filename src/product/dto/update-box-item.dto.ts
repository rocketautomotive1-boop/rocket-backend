import { PartialType } from '@nestjs/mapped-types';
import { CreateBoxItemDto } from './create-box-item.dto';

export class UpdateBoxItemDto extends PartialType(CreateBoxItemDto) {} 