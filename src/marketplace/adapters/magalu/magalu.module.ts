import { Module } from '@nestjs/common';
import { MagaluController } from '../../controllers/magalu.controller';
import { MagaluAuthAdapter } from './magalu-auth.adapter';
import { MagaluProductAdapter } from './magalu-product.adapter';

@Module({
  controllers: [MagaluController],
  providers: [
    MagaluAuthAdapter,
    MagaluProductAdapter,
  ],
  exports: [
    MagaluAuthAdapter,
    MagaluProductAdapter,
  ],
})
export class MagaluModule {} 