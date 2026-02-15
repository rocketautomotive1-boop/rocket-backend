import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceAuthModule } from '../../auth/marketplace-auth.module';
import { YampiAdapter } from './yampi.adapter';
import { YampiAuthAdapter } from './yampi-auth.adapter';
import { YampiProductAdapter } from './yampi-product.adapter';
import { YampiOrderAdapter } from './yampi-order.adapter';
import { YampiCategoryAdapter } from './yampi-category.adapter';
import { YampiController } from './yampi.controller';

@Module({
  imports: [
    forwardRef(() => MarketplaceAuthModule),
  ],
  controllers: [YampiController],
  providers: [
    YampiAdapter,
    YampiAuthAdapter,
    YampiProductAdapter,
    YampiOrderAdapter,
    YampiCategoryAdapter,
  ],
  exports: [
    YampiAdapter,
    YampiAuthAdapter,
    YampiProductAdapter,
    YampiOrderAdapter,
    YampiCategoryAdapter,
  ],
})
export class YampiModule { } 