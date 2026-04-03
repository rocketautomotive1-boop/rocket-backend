import { Module, forwardRef } from '@nestjs/common';
import { TikTokShopAdapter } from './tiktok-shop.adapter';
import { TikTokShopAuthAdapter } from './tiktok-shop-auth.adapter';
import { TikTokShopProductAdapter } from './tiktok-shop-product.adapter';
import { TikTokShopOrderAdapter } from './tiktok-shop-order.adapter';
import { TikTokShopCategoryAdapter } from './tiktok-shop-category.adapter';
import { MarketplaceAuthModule } from '../../auth/marketplace-auth.module';
import { MarketplaceRegistryModule } from '../../marketplace-registry.module';

@Module({
  imports: [
    forwardRef(() => MarketplaceAuthModule),
    MarketplaceRegistryModule,
  ],
  providers: [
    TikTokShopAdapter,
    TikTokShopAuthAdapter,
    TikTokShopProductAdapter,
    TikTokShopOrderAdapter,
    TikTokShopCategoryAdapter,
  ],
  exports: [
    TikTokShopAdapter,
    TikTokShopAuthAdapter,
    TikTokShopProductAdapter,
    TikTokShopOrderAdapter,
    TikTokShopCategoryAdapter,
  ],
})
export class TikTokShopModule {}
