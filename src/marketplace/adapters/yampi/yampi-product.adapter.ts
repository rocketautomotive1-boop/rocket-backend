import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class YampiProductAdapter {
  private readonly logger = new Logger(YampiProductAdapter.name);
  private readonly apiUrl = 'https://api.dooki.com.br/v2';

  async createProduct(product: any): Promise<any> {
    try {
      const { token, merchantAlias, ...productData } = product;

      const formattedProduct = this.formatProductForYampi(productData);

      const response = await axios.post(
        `${this.apiUrl}/${merchantAlias}/catalog/products`,
        formattedProduct,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Produto criado na Yampi com ID: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    try {
      const { token, merchantAlias, ...productData } = product;

      const formattedProduct = this.formatProductForYampi(productData);

      const response = await axios.put(
        `${this.apiUrl}/${merchantAlias}/catalog/products/${externalId}`,
        formattedProduct,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Produto atualizado na Yampi: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductImages(externalId: string, imageData: any): Promise<any> {
    try {
      const { token, merchantAlias, images } = imageData;

      const formattedImages = images.map((image: any) => ({
        url: image.url || image.uri,
        alt: image.alt || image.description || '',
        position: image.position || 0
      }));

      const response = await axios.put(
        `${this.apiUrl}/${merchantAlias}/catalog/products/${externalId}/images`,
        { images: formattedImages },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Imagens do produto atualizadas na Yampi: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar imagens do produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductTitle(externalId: string, titleData: any): Promise<any> {
    try {
      const { token, merchantAlias, title } = titleData;

      const response = await axios.patch(
        `${this.apiUrl}/${merchantAlias}/catalog/products/${externalId}`,
        { name: title },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Título do produto atualizado na Yampi: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar título do produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    try {
      const { token, merchantAlias, categoryId } = category;

      const response = await axios.patch(
        `${this.apiUrl}/${merchantAlias}/catalog/products/${externalId}`,
        { category_id: categoryId },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria do produto atualizada na Yampi: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar categoria do produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    try {
      const { token, merchantAlias, stock, price } = inventory;

      const updateData: any = {};
      if (stock !== undefined) updateData.stock = stock;
      if (price !== undefined) updateData.price = price;

      const response = await axios.patch(
        `${this.apiUrl}/${merchantAlias}/catalog/products/${externalId}`,
        updateData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Inventário do produto atualizado na Yampi: ${externalId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar inventário do produto na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    const requiredFields = [
      'name',
      'description',
      'price',
      'stock',
      'category_id'
    ];

    const missingFields = requiredFields.filter(field => !product[field]);

    return {
      isValid: missingFields.length === 0,
      missingRequirements: missingFields
    };
  }

  private formatProductForYampi(product: any): any {
    return {
      name: product.name || product.title,
      description: product.description,
      price: product.price,
      stock: product.stock || product.quantity || 0,
      category_id: product.category_id || product.categoryId || (product.category as any)?.id || (product.category as any)?._id,
      brand: product.brand,
      weight: product.weight,
      height: product.height,
      width: product.width,
      length: product.length,
      sku: String(product._id || product.id),
      ean: product.ean,
      images: product.images?.map((image: any) => ({
        url: image.url || image.uri,
        alt: image.alt || image.description || '',
        position: image.position || 0
      })) || [],
      attributes: product.attributes || [],
      is_active: product.is_active !== false, // Por padrão, produto ativo
      is_visible: product.is_visible !== false // Por padrão, produto visível
    };
  }
} 