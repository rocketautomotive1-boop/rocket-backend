import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { Types } from 'mongoose';
import { ProductDocument } from '../../product/product-types';
import { ProductTitle } from '../../product/product-types';
import { MarketplaceDocument } from '../schemas/marketplace.schema'

import { AmazonAdapter } from '../adapters/amazon/amazon.adapter'
import { MarketplaceRegistryService } from './marketplace-registry.service'
import { AuthRetryService } from '../adapters/shared/auth-retry.service'
import { MarketplaceIntegrationHelperService } from './marketplace-integration-helper.service'
import { ProductService } from '../../product/product.service';
import { ListingService } from '../../listing/listing.service'; // [NEW] Import

@Injectable()
export class AmazonService {
  private readonly logger = new Logger(AmazonService.name)

  constructor(

    private amazonAdapter: AmazonAdapter,
    private marketplaceRegistry: MarketplaceRegistryService,
    private authRetry: AuthRetryService,
    @Inject(forwardRef(() => MarketplaceIntegrationHelperService))
    private helperService: MarketplaceIntegrationHelperService,
    @Inject(forwardRef(() => ProductService))
    private productService: ProductService,
    private listingService: ListingService, // [NEW] Inject
  ) { }

  async createProduct(product: ProductDocument, marketplace: MarketplaceDocument): Promise<any> {
    this.logger.log(`Criando/atualizando item no Amazon SP-API para produto ID ${String(product._id)}`)
    try {
      const executeCreate = async (currentToken: any) => {
        if (!currentToken?.accessToken) throw new Error('Token LWA não disponível para a Amazon')
        const sellerId = process.env.AMAZON_SELLER_ID || currentToken.additionalData?.sellerId
        if (!sellerId) throw new Error('SellerId não configurado (AMAZON_SELLER_ID)')

        const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || process.env.SPAPI_ENDPOINT || 'https://sandbox.sellingpartnerapi-na.amazon.com'
        const region = process.env.AMAZON_AWS_REGION || process.env.AWS_REGION || 'us-east-1'
        const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || ''
        const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || ''
        if (!accessKeyId || !secretAccessKey) throw new Error('Credenciais AWS não configuradas')

        const sku = String(product.partNumber || String(product._id))

        // Obter descrição formatada, tratando erro se template não encontrado
        let description = '';
        try {
          description = await this.helperService.getFormattedDescription(product, String(marketplace._id));
        } catch (descError) {
          this.logger.warn(`Erro ao gerar descrição formatada: ${descError.message}. Usando descrição curta.`);
          description = product.description || '';
        }

        const productWithToken = {
          ...product,
          description,
          token: {
            accessToken: currentToken.accessToken,
            additionalData: { sellerId }
          }
        };

        const response = await this.amazonAdapter.createProduct(productWithToken);
        this.logger.log(`Amazon Adapter response: ${JSON.stringify(response)}`);

        // Update Title External ID with Submission ID - REMOVED per user request (Keep ASIN)
        /*
        if (response?.submissionId) {
          const amazonTitle = product.titles?.find(t => t.marketplace?.name === 'Amazon' || t.marketplaceId === 6);
          if (amazonTitle) {
            amazonTitle.externalId = response.submissionId;
            await this.productTitleRepository.save(amazonTitle);
            this.logger.log(`Updated Title (ID ${amazonTitle.id}) externalId to ${response.submissionId}`);
          }
        }
        */

        // [REF] Update Listing via Service
        // Check for existing listing for this marketplace
        const existingListing = await this.listingService.findOne({
          productId: typeof product._id === 'string' ? new Types.ObjectId(product._id) : product._id,
          marketplaceId: marketplace._id
        });

        if (existingListing) {
          await this.listingService.update(existingListing.id, {
            externalId: sku,
            lastSyncAt: new Date(),
            status: 'active' // Synced
          });
        } else {
          await this.listingService.create({
            productId: typeof product._id === 'string' ? new Types.ObjectId(product._id) : product._id,
            marketplaceId: marketplace._id,
            title: product.name,
            externalId: sku,
            status: 'active',
            lastSyncAt: new Date(),
            locale: 'pt-BR'
          });
        }

        // REMOVED: await (product as any).save(); (Listings are separate now)

        return { success: true, response, externalId: sku }
      }

      // Auth-retry canônico: resolve/renova o token LWA (conta default Amazon) e
      // retenta 1x no 403/Unauthorized/expirado.
      return await this.authRetry.run(
        { marketplaceId: String(marketplace._id), context: 'amazon.createProduct' },
        (currentToken) => executeCreate(currentToken),
      );

    } catch (error) {
      return this.helperService.handleError(error, marketplace, 'create')
    }
  }
}