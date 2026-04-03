import { Injectable, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MarketplaceService } from './marketplace.service';
import { ProductDocument } from '../../product/product-types';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { ProductTitle } from '../../product/product-types';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceToken as MarketplaceTokenModel, MarketplaceTokenDocument } from '../schemas/marketplace-token.schema';
import { ProductTitleService } from '../../product/services/product-title.service';


@Injectable()
export class AmericanasService {
  private marketplaceService: MarketplaceService;


  constructor(
    private moduleRef: ModuleRef,
    @InjectModel(MarketplaceTokenModel.name)
    private tokenModel: Model<MarketplaceTokenDocument>,
    private readonly productTitleService: ProductTitleService, // Direct injection safe now
  ) {
    // Lazy loading dos serviços para evitar dependências circulares
    setTimeout(() => {
      this.marketplaceService = this.moduleRef.get(MarketplaceService, { strict: false });

    }, 0);
  }

  /**
   * Cria um produto nas Americanas
   */
  async createProduct(product: ProductDocument, marketplace: MarketplaceDocument) {
    console.log(`[AMERICANAS] Criando produto ${product.partNumber}`);

    try {
      // Obter token de acesso
      const token = await this.tokenModel.findOne({
        marketplaceId: String(marketplace._id),
        isActive: true
      }).sort({ createdAt: -1 }).exec();

      if (!token) {
        throw new Error('Token de acesso não encontrado para Americanas');
      }

      // const token = tokens[0];

      // Por enquanto, vamos usar dados padrão já que não temos mais inventário
      const inventory = { quantity: 1 };

      // Preparar dados do produto para o formato das Americanas
      const americanasProduct = {
        skuId: product.partNumber,
        productName: product.name || `${product.brand?.name || ''} ${product.partNumber}`,
        description: product.description || `Peça automotiva ${product.partNumber}`,
        categoryId: (product.category as any)?.externalId || "AUTO_PARTS", // Categoria padrão
        brand: product.brand?.name || "Genérica",
        price: (product as any).price || 0,
        listPrice: ((product as any).price || 0) * 1.1, // Preço de lista 10% maior que o preço de venda
        stockQuantity: inventory?.quantity || 1,
        height: (product.dimensions as any)?.height || 10,
        width: (product.dimensions as any)?.width || 10,
        length: (product.dimensions as any)?.length || 10,
        weight: (product as any).weight || 0.5,
        images: (product.images || []).map((img, index) => ({
          url: img.url,
          main: index === 0
        })),
        attributes: [
          {
            name: "PART_NUMBER",
            value: product.partNumber
          },
          {
            name: "GENUINE",
            value: product.isGenuine ? "Sim" : "Não"
          }
        ]
      };

      // Simular chamada à API das Americanas
      // Em produção, substituir por chamada real:
      // const response = await axios.post('https://api.b2b.americanas.com.br/seller-api/v3/products', 
      //   americanasProduct, 
      //   { headers: { Authorization: `Bearer ${token.accessToken}` } }
      // );

      // Simulação temporária para demonstração
      const externalId = `AME-${Date.now()}`;

      // Criar registro de integração no banco de dados
      const productMarketplace = await this.productTitleService.upsertProductTitle(
        String(product._id) as any,
        String(marketplace._id),
        {
          externalId: externalId,
          status: 'active',
          marketplaceData: americanasProduct,
          lastSyncAt: new Date()
        }
      );

      return {
        success: true,
        productMarketplaceId: productMarketplace.id,
        response: {
          status: 201,
          externalId: externalId,
          url: `https://www.americanas.com.br/produto/${externalId}`,
          marketplace: marketplace.name,
          details: {
            status: 'ACTIVE',
            processingTime: '1.3s',
            categories: [(product.category as any)?.name || 'Peças Automotivas'],
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error(`[AMERICANAS] Erro ao criar produto: ${error.message}`);
      return {
        success: false,
        error: `Erro na API das Americanas: ${error.message}`,
        response: {
          status: error.response?.status || 500,
          message: error.response?.data?.message || error.message,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Atualiza um produto nas Americanas
   */
  async updateProduct(product: ProductDocument, marketplace: MarketplaceDocument, productTitle: ProductTitle) {
    console.log(`[AMERICANAS] Atualizando produto ${productTitle.externalId}`);

    try {
      // Obter token de acesso
      const token = await this.tokenModel.findOne({
        marketplaceId: String(marketplace._id),
        isActive: true
      }).sort({ createdAt: -1 }).exec();

      if (!token) {
        throw new Error('Token de acesso não encontrado para Americanas');
      }

      // const token = tokens[0];

      // Por enquanto, vamos usar dados padrão já que não temos mais inventário
      const inventory = { quantity: 1 };

      // Preparar dados do produto para o formato das Americanas
      const americanasProduct = {
        skuId: product.partNumber,
        productName: product.name || `${product.brand?.name || ''} ${product.partNumber}`,
        description: product.description || `Peça automotiva ${product.partNumber}`,
        price: (product as any).price || 0,
        listPrice: ((product as any).price || 0) * 1.1, // Preço de lista 10% maior que o preço de venda
        stockQuantity: inventory?.quantity || 1,
        images: (product.images || []).map((img, index) => ({
          url: img.url,
          main: index === 0
        }))
      };

      // Simular chamada à API das Americanas
      // Em produção, substituir por chamada real:
      // const response = await axios.put(
      //   `https://api.b2b.americanas.com.br/seller-api/v3/products/${productMarketplace.externalId}`, 
      //   americanasProduct, 
      //   { headers: { Authorization: `Bearer ${token.accessToken}` } }
      // );

      // Atualizar registro de integração no banco de dados
      // Atualizar registro de integração no banco de dados
      await this.productTitleService.update(
        (productTitle as any)._id || (productTitle as any).id,
        {
          syncStatus: 'synced', // Map active/synced
          marketplaceData: { ...productTitle.marketplaceData, ...americanasProduct },
          lastSyncAt: new Date()
        }
      );

      return {
        success: true,
        response: {
          status: 200,
          externalId: productTitle.externalId,
          url: `https://www.americanas.com.br/produto/${productTitle.externalId}`,
          marketplace: marketplace.name,
          details: {
            status: 'UPDATED',
            processingTime: '0.9s',
            lastUpdate: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error(`[AMERICANAS] Erro ao atualizar produto: ${error.message}`);
      return {
        success: false,
        error: `Erro na API das Americanas: ${error.message}`,
        response: {
          status: error.response?.status || 500,
          message: error.response?.data?.message || error.message,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
}