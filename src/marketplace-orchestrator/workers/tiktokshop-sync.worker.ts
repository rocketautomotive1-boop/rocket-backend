import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import axios from 'axios';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';
import { PayloadBuilderService } from '../services/payload-builder.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';
import {
  getTikTokShopBaseUrl,
  buildSignedParams,
  buildHeaders,
} from '../../marketplace/adapters/tiktok-shop/tiktok-shop-utils';

@Injectable()
export class TikTokShopSyncWorker {
  private readonly logger = new Logger(TikTokShopSyncWorker.name);
  private readonly baseUrl = getTikTokShopBaseUrl();

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly resilienceService: MarketplaceResilienceService,
    private readonly payloadBuilder: PayloadBuilderService,
    @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
  ) {}

  @RabbitSubscribe({
    exchange: 'rocket.marketplace.sync',
    routingKey: 'sync.tiktokshop',
    queue: 'q.sync.tiktokshop',
  })
  async handleTikTokShopSync(msg: MarketplaceSyncPayload) {
    this.logger.log(`[TikTok Shop] Processing job ${msg.jobId} for listing ${msg.listingId} (${msg.action})`);

    const result: MarketplaceSyncResult = {
      jobId: msg.jobId,
      listingId: msg.listingId,
      marketplaceId: msg.marketplaceId,
      success: false,
      action: msg.action,
      timestamp: new Date(),
    };

    try {
      if (msg.action === 'CREATE') {
        const freshListing = await this.listingModel
          .findById(msg.listingId)
          .select('externalId status')
          .lean()
          .exec();

        if (freshListing?.externalId) {
          this.logger.warn(
            `[Idempotency] Listing ${msg.listingId} already has externalId=${freshListing.externalId}. ` +
            `Upgrading action from CREATE to UPDATE.`,
          );
          msg.action = 'UPDATE';
          msg.externalId = freshListing.externalId;
        }
      }

      await this.resilienceService.execute(msg.marketplaceId, async (token) => {
        const shopCipher = token.additionalData?.shopCipher;
        if (!shopCipher && !token.additionalData?.shopId) {
          this.logger.warn('[TikTok Shop] No shopCipher or shopId in token — proceeding without shop context');
        }

        const timestamp = Math.floor(Date.now() / 1000);

        if (msg.action === 'CREATE') {
          const imageUris = await this.prepareImages(msg.payload.images, token, shopCipher);
          const body = this.payloadBuilder.buildTikTokShopCreateBody(msg, imageUris);

          const path = '/product/202309/products';
          const bodyStr = JSON.stringify(body);
          const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

          this.logger.log(`[TikTok Shop] add_product payload for listing ${msg.listingId}:\n${JSON.stringify(body, null, 2)}`);

          const response = await axios.post(`${this.baseUrl}${path}`, body, {
            headers: buildHeaders(token.accessToken),
            params,
          });

          if (response.data?.code !== 0) {
            throw new Error(`TikTok Shop API Error: ${response.data?.message || JSON.stringify(response.data)}`);
          }

          const productId = response.data?.data?.product_id;
          if (!productId) {
            throw new Error(`Invalid TikTok Shop Response (No product_id): ${JSON.stringify(response.data)}`);
          }

          result.externalId = String(productId);

          await this.activateProduct(productId, token, shopCipher);

          this.logger.log(`[TikTok Shop] Created product ${result.externalId}`);

        } else if (msg.action === 'DELETE') {
          if (!msg.externalId) throw new Error('DELETE action requires externalId');

          const path = '/product/202309/products/deactivate';
          const body = this.payloadBuilder.buildTikTokShopDeleteBody(msg.externalId);
          const bodyStr = JSON.stringify(body);
          const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

          const response = await axios.post(`${this.baseUrl}${path}`, body, {
            headers: buildHeaders(token.accessToken),
            params,
          });

          if (response.data?.code !== 0) {
            throw new Error(`TikTok Shop deactivate error: ${response.data?.message || JSON.stringify(response.data)}`);
          }

          result.externalId = msg.externalId;
          this.logger.log(`[TikTok Shop] Deactivated product ${msg.externalId}`);

        } else if (msg.action === 'UPDATE') {
          if (!msg.externalId) throw new Error('UPDATE action requires externalId');

          const partialErrors: string[] = [];

          // 1. Content update — tolerated
          try {
            const imageUris = await this.prepareImages(msg.payload.images, token, shopCipher);
            const contentBody = this.payloadBuilder.buildTikTokShopUpdateContentBody(msg, imageUris);

            const path = `/product/202309/products/${msg.externalId}`;
            const bodyStr = JSON.stringify(contentBody);
            const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

            const response = await axios.put(`${this.baseUrl}${path}`, contentBody, {
              headers: buildHeaders(token.accessToken),
              params,
            });

            if (response.data?.code !== 0) throw new Error(response.data?.message || JSON.stringify(response.data));
            this.logger.log(`[TikTok Shop] update_product content OK for ${msg.externalId}`);
          } catch (e) {
            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            this.logger.warn(`[TikTok Shop] Content update failed — proceeding with inventory/price: ${detail}`);
            partialErrors.push(`content: ${detail}`);
          }

          // 2. Inventory update — critical
          if (msg.payload.stock !== undefined) {
            try {
              await this.updateInventory(msg.externalId, msg.payload.stock, token, shopCipher);
              this.logger.log(`[TikTok Shop] updateInventory OK for ${msg.externalId}`);
            } catch (e) {
              const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
              this.logger.error(`[TikTok Shop] updateInventory failed for ${msg.externalId}: ${detail}`);
              partialErrors.push(`stock: ${detail}`);
            }
          }

          // 3. Price update — critical
          if (msg.payload.price !== undefined && msg.payload.price > 0) {
            try {
              await this.updatePrice(msg.externalId, msg.payload.price, token, shopCipher);
              this.logger.log(`[TikTok Shop] updatePrice OK for ${msg.externalId}`);
            } catch (e) {
              const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
              this.logger.error(`[TikTok Shop] updatePrice failed for ${msg.externalId}: ${detail}`);
              partialErrors.push(`price: ${detail}`);
            }
          }

          result.externalId = msg.externalId;

          if (partialErrors.length > 0) {
            this.logger.warn(`[TikTok Shop] UPDATE partial for ${msg.externalId}: ${partialErrors.join(' | ')}`);
            const criticalErrors = partialErrors.filter((e) => e.startsWith('stock:') || e.startsWith('price:'));
            if (criticalErrors.length > 0) throw new Error(criticalErrors.join(' | '));
          } else {
            this.logger.log(`[TikTok Shop] Updated product ${result.externalId}`);
          }
        }
      });

      result.success = true;
    } catch (error) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`[TikTok Shop] Failed job ${msg.jobId}: ${errorMsg}`);
      result.success = false;
      result.errorMessage = errorMsg;
    } finally {
      await this.amqpConnection.publish('rocket.marketplace.results', 'result.tiktokshop', result);
    }
  }

  private async activateProduct(productId: string, token: any, shopCipher?: string): Promise<void> {
    try {
      const path = '/product/202309/products/activate';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = { product_ids: [productId] };
      const bodyStr = JSON.stringify(body);
      const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

      await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params,
      });

      this.logger.log(`[TikTok Shop] Product ${productId} activated`);
    } catch (e) {
      this.logger.warn(`[TikTok Shop] Could not activate product ${productId}: ${e.message}`);
    }
  }

  private async updateInventory(productId: string, stock: number, token: any, shopCipher?: string): Promise<void> {
    const path = '/product/202309/products/inventory/update';
    const timestamp = Math.floor(Date.now() / 1000);
    const body = this.payloadBuilder.buildTikTokShopInventoryBody(productId, stock);

    const bodyStr = JSON.stringify(body);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    const response = await axios.post(`${this.baseUrl}${path}`, body, {
      headers: buildHeaders(token.accessToken),
      params,
    });

    if (response.data?.code !== 0) {
      throw new Error(`Inventory update error: ${response.data?.message || JSON.stringify(response.data)}`);
    }
  }

  private async updatePrice(productId: string, price: number, token: any, shopCipher?: string): Promise<void> {
    const path = `/product/202309/products/prices`;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = this.payloadBuilder.buildTikTokShopPriceBody(productId, price);

    const bodyStr = JSON.stringify(body);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    const response = await axios.put(`${this.baseUrl}${path}`, body, {
      headers: buildHeaders(token.accessToken),
      params,
    });

    if (response.data?.code !== 0) {
      throw new Error(`Price update error: ${response.data?.message || JSON.stringify(response.data)}`);
    }
  }

  private async prepareImages(images: string[], token: any, shopCipher?: string): Promise<string[]> {
    const result: string[] = [];
    const uniqueImages = [...new Set(images || [])].slice(0, 9);

    for (const img of uniqueImages) {
      try {
        if (!img) continue;
        const uri = await this.uploadImage(img, token, shopCipher);
        if (uri) result.push(uri);
      } catch (e) {
        this.logger.warn(`Failed to upload image ${img}: ${e.message}`);
      }
    }
    return result;
  }

  private async uploadImage(imageUrl: string, token: any, shopCipher?: string): Promise<string | null> {
    const path = '/product/202309/images/upload';
    const timestamp = Math.floor(Date.now() / 1000);
    const body = { image_url: imageUrl };
    const bodyStr = JSON.stringify(body);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    try {
      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params,
        timeout: 15000,
      });

      if (response.data?.code === 0 && response.data?.data?.uri) {
        return response.data.data.uri;
      }

      this.logger.warn(`[TikTok Shop] Image upload response: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error) {
      this.logger.warn(`[TikTok Shop] Image upload error: ${error.message}`);
      return null;
    }
  }
}
