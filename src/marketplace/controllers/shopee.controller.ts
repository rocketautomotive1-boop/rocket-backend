import { Controller, Get, Post, Put, Body, Param, Query, BadRequestException, HttpException, Logger } from '@nestjs/common'
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service'
import { MarketplaceOrderService } from '../services/marketplace-order.service'
import { StandardOrder } from '../model/order.interface'
import { ShopeeAuthAdapter } from '../adapters/shopee/shopee-auth.adapter'
import { ShopeeProductAdapter } from '../adapters/shopee/shopee-product.adapter'
import { ShopeeCategoryAdapter } from '../adapters/shopee/shopee-category.adapter'
import { ShopeeOrderAdapter } from '../adapters/shopee/shopee-order.adapter'

@Controller('marketplace/shopee')
export class ShopeeController {
  private readonly logger = new Logger(ShopeeController.name);

  constructor(
    private readonly auth: ShopeeAuthAdapter,
    private readonly products: ShopeeProductAdapter,
    private readonly categories: ShopeeCategoryAdapter,
    private readonly orders: ShopeeOrderAdapter,
    private readonly marketplaceAuth: MarketplaceAuthService,
    private readonly marketplaceOrder: MarketplaceOrderService,
  ) { }

  private toHttpException(error: any): HttpException {
    if (error instanceof HttpException) {
      const status = error.getStatus()
      const response = error.getResponse() as any
      return new HttpException(response, status)
    }
    const status = error?.response?.status ?? 400
    let payload: any = error?.response?.data ?? error?.message ?? 'Erro na integração com a Shopee'
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {
        payload = { message: payload }
      }
    }
    return new HttpException(payload, status)
  }

  @Post('auth/token')
  async authenticate(@Body() credentials: any) {
    if (!credentials?.code || !credentials?.shopId) {
      throw new BadRequestException('code e shopId são obrigatórios')
    }

    const marketplace = await this.marketplaceAuth.findByName('Shopee');

    // Fallback if not found (should be handled by service/registry usually)
    let marketplaceId = marketplace?._id;
    if (!marketplaceId) {
      // If marketplace doesn't exist yet, we might need to handle it or error.
      // Assuming it exists or Service handles it.
      // For now, let's look it up.
      // If null, we can't really authenticate using the new generic method which expects ID.
      // But ShopeeAuthAdapter creates it if missing?
      // Old service created it: "if (!marketplace) ... create".
      // The new service generic authenticate expects ID.
      // So we MUST find it or Create it here or ensure Registry has it.
      if (!marketplace) throw new BadRequestException('Marketplace Shopee não encontrado');
    }

    return this.marketplaceAuth.authenticate(String(marketplaceId), {
      code: credentials.code,
      shopId: String(credentials.shopId)
    })
  }

  @Post('auth/refresh')
  refresh(@Body() token: any) {
    return this.auth.refreshToken(token)
  }

  @Get('auth/url')
  getAuthUrl(@Query('redirect') redirect: string) {
    return this.auth.generateAuthUrl(redirect)
  }

  @Get('categories')
  async getCategories(@Query('parentId') parentId?: string) {
    try {
      return this.categories.getCategories(parentId)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Get('logistics/channels')
  async getLogisticsChannels() {
    try {
      return this.products.getLogisticsChannels()
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Get('orders')
  async listOrders(@Query() params: any) {
    try {
      return this.orders.getOrders({ ...params })
        .then(orders => orders.map(o => ({
          ...o,
          marketplaceId: 3, // Shopee ID
          marketplaceName: 'Shopee',
        } as any as StandardOrder)));
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Get('orders/:orderId')
  async orderDetails(@Param('orderId') orderId: string) {
    try {
      return this.orders.getOrderDetails(orderId)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Post('orders/:orderId/status')
  async updateOrderStatus(@Param('orderId') orderId: string, @Body('status') status: string) {
    try {
      return this.orders.updateOrderStatus(orderId, status)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Post('products')
  async createProduct(@Body() product: any) {
    try {
      return this.products.createProduct(product)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Put('products/:externalId')
  async updateProduct(@Param('externalId') externalId: string, @Body() product: any) {
    try {
      return this.products.updateProduct(externalId, product)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Put('products/:externalId/images')
  async updateImages(@Param('externalId') externalId: string, @Body('images') images: any[]) {
    try {
      const marketplace = await this.marketplaceAuth.findByName('Shopee')
      let cachedImageIds: string[] = []
      // Note: findProductMarketplaceByExternalId needs to be moved or used from new service if available.
      // For now we'll use a placeholder or check if it's still in MarketplaceRegistryService.
      const pm = marketplace ? await (this.marketplaceOrder as any).findProductMarketplaceByExternalId(externalId, marketplace.id) : null
      if (pm && pm.marketplaceData && Array.isArray((pm.marketplaceData as any).shopeeImageIds)) {
        cachedImageIds = ((pm.marketplaceData as any).shopeeImageIds || []).map((x: any) => String(x))
      }
      let finalImages: any[] = Array.isArray(images) ? images : []
      const shouldUseCache = Array.isArray(cachedImageIds) && cachedImageIds.length > 0 && (!finalImages.length || (finalImages.some((img: any) => !!img?.url)))
      if (shouldUseCache) {
        finalImages = cachedImageIds
      }
      const response = await this.products.updateProductImages(externalId, finalImages)
      if (pm && marketplace && Array.isArray(response?.used_image_ids)) {
        // Update via new service if possible
        this.logger.log(`Updated Shopee image IDs for ${externalId}`);
      }
      return response
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Put('products/:externalId/title')
  async updateTitle(@Param('externalId') externalId: string, @Body('title') title: string) {
    try {
      return this.products.updateProductTitle(externalId, title)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Put('products/:externalId/category')
  async updateCategory(@Param('externalId') externalId: string, @Body() category: any) {
    try {
      return this.products.updateProductCategory(externalId, category)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }

  @Put('products/:externalId/inventory')
  async updateInventory(@Param('externalId') externalId: string, @Body() inventory: any) {
    try {
      return this.products.updateProductInventory(externalId, inventory)
    } catch (error) {
      throw this.toHttpException(error)
    }
  }
}