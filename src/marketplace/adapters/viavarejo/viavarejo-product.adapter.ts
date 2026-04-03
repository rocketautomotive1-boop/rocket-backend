import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ViaVarejoProductAdapter {
  private readonly logger = new Logger(ViaVarejoProductAdapter.name);
  private readonly apiUrl = 'https://api.grupocasasbahia.com.br';

  async createProduct(product: any): Promise<any> {
    try {
      const { token, sellerId, ...productData } = product;

      const formattedProduct = this.formatProductForViaVarejo(productData);

      const response = await axios.post(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products`,
        formattedProduct,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Produto criado na Via Varejo com ID: ${response.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    try {
      const { token, sellerId, ...productData } = product;

      const formattedProduct = this.formatProductForViaVarejo(productData);

      const response = await axios.put(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products/${externalId}`,
        formattedProduct,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Produto atualizado na Via Varejo: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductImages(externalId: string, imageData: any): Promise<any> {
    try {
      const { token, sellerId, images } = imageData;

      const formattedImages = images.map((image: any) => ({
        url: image.url || image.uri,
        alt: image.alt || image.description || '',
        position: image.position || 0
      }));

      const response = await axios.put(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products/${externalId}/images`,
        { images: formattedImages },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Imagens do produto atualizadas na Via Varejo: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar imagens do produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductTitle(externalId: string, titleData: any): Promise<any> {
    try {
      const { token, sellerId, title } = titleData;

      const response = await axios.patch(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products/${externalId}`,
        { title: title },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Título do produto atualizado na Via Varejo: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar título do produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    try {
      const { token, sellerId, categoryId } = category;

      const response = await axios.patch(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products/${externalId}`,
        { category_id: categoryId },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria do produto atualizada na Via Varejo: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar categoria do produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    try {
      const { token, sellerId, stock, price } = inventory;

      const updateData: any = {};
      if (stock !== undefined) updateData.stock = stock;
      if (price !== undefined) updateData.price = price;

      const response = await axios.patch(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products/${externalId}`,
        updateData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Inventário do produto atualizado na Via Varejo: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar inventário do produto na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    const requiredFields = [
      'title',
      'description',
      'price',
      'stock',
      'category_id',
      'brand',
      'model'
    ];

    const missingFields = requiredFields.filter(field => !product[field]);

    return {
      isValid: missingFields.length === 0,
      missingRequirements: missingFields
    };
  }

  private formatProductForViaVarejo(product: any): any {
    return {
      title: product.title || product.name,
      description: product.description,
      price: product.price,
      stock: product.stock || product.quantity || 0,
      category_id: product.category_id || product.categoryId || (product.category as any)?.id || (product.category as any)?._id,
      brand: product.brand,
      model: product.model,
      sku: String(product._id || product.id),
      ean: product.ean,
      weight: product.weight,
      height: product.height,
      width: product.width,
      length: product.length,
      images: product.images?.map((image: any) => ({
        url: image.url || image.uri,
        alt: image.alt || image.description || '',
        position: image.position || 0
      })) || [],
      attributes: product.attributes || [],
      is_active: product.is_active !== false, // Por padrão, produto ativo
      warranty: product.warranty,
      warranty_type: product.warranty_type,
      warranty_period: product.warranty_period
    };
  }
} 