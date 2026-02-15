import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ViaVarejoCategoryAdapter {
  private readonly logger = new Logger(ViaVarejoCategoryAdapter.name);
  private readonly apiUrl = 'https://api.grupocasasbahia.com.br';

  async getCategories(accessToken: string, sellerId: string, parentId?: string): Promise<any[]> {
    try {
      const params: any = {
        limit: 100,
        include: 'children'
      };
      
      if (parentId) {
        params.parent_id = parentId;
      }

      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          params
        }
      );

      this.logger.log(`Categorias obtidas da Via Varejo: ${response.data.data.length}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter categorias da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCategoryById(categoryId: string, accessToken: string, sellerId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories/${categoryId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria obtida da Via Varejo: ${categoryId}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter categoria da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createCategory(category: any): Promise<any> {
    try {
      const { token, sellerId, ...categoryData } = category;
      
      const response = await axios.post(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories`,
        categoryData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria criada na Via Varejo: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar categoria na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateCategory(categoryId: string, category: any): Promise<any> {
    try {
      const { token, sellerId, ...categoryData } = category;
      
      const response = await axios.put(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories/${categoryId}`,
        categoryData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria atualizada na Via Varejo: ${categoryId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar categoria na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteCategory(categoryId: string, accessToken: string, sellerId: string): Promise<any> {
    try {
      const response = await axios.delete(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories/${categoryId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria deletada na Via Varejo: ${categoryId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao deletar categoria na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCategoryAttributes(categoryId: string, accessToken: string, sellerId: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/categories/${categoryId}/attributes`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Atributos da categoria obtidos da Via Varejo: ${categoryId}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter atributos da categoria da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }
} 