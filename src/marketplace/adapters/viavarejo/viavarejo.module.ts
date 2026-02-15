import { Module } from '@nestjs/common';
import { ViaVarejoAdapter } from './viavarejo.adapter';
import { ViaVarejoAuthAdapter } from './viavarejo-auth.adapter';
import { ViaVarejoProductAdapter } from './viavarejo-product.adapter';
import { ViaVarejoOrderAdapter } from './viavarejo-order.adapter';
import { ViaVarejoCategoryAdapter } from './viavarejo-category.adapter';
import { ViaVarejoController } from './viavarejo.controller';

@Module({
  controllers: [ViaVarejoController],
  providers: [
    ViaVarejoAdapter,
    ViaVarejoAuthAdapter,
    ViaVarejoProductAdapter,
    ViaVarejoOrderAdapter,
    ViaVarejoCategoryAdapter,
  ],
  exports: [
    ViaVarejoAdapter,
    ViaVarejoAuthAdapter,
    ViaVarejoProductAdapter,
    ViaVarejoOrderAdapter,
    ViaVarejoCategoryAdapter,
  ],
})
export class ViaVarejoModule {} 