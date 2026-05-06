import { applyDecorators, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from './internal-key.guard';

export const InternalHeader = () => applyDecorators(UseGuards(InternalKeyGuard));
