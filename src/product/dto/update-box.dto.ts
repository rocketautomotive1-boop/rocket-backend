import { PartialType } from '@nestjs/mapped-types';
import { CreateBoxDto } from './create-box.dto';

export class UpdateBoxDto extends PartialType(CreateBoxDto) {} 