import { Module } from '@nestjs/common';
import { MagaluAuthAdapter } from './magalu-auth.adapter';
import { MagaluHttpClient } from './magalu-http-client';
import { MagaluProductAdapter } from './magalu-product.adapter';
import { MagaluOrderAdapter } from './magalu-order.adapter';
import { MagaluCategoryAdapter } from './magalu-category.adapter';
import { MagaluAdapter } from './magalu.adapter';

@Module({
  providers: [
    MagaluAuthAdapter,
    MagaluHttpClient,
    MagaluProductAdapter,
    MagaluOrderAdapter,
    MagaluCategoryAdapter,
    MagaluAdapter,
  ],
  exports: [
    MagaluAuthAdapter,
    MagaluHttpClient,
    MagaluProductAdapter,
    MagaluOrderAdapter,
    MagaluCategoryAdapter,
    MagaluAdapter,
  ],
})
export class MagaluModule {}
