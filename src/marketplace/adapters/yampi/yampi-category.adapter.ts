import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class YampiCategoryAdapter {
  private readonly logger = new Logger(YampiCategoryAdapter.name);
  private readonly apiUrl = 'https://api.dooki.com.br/v2';

  async getCategories(accessToken: string, merchantAlias: string, parentId?: string): Promise<any[]> {
    try {
      const params: any = {
        limit: 100,
        include: 'children'
      };
      
      if (parentId) {
        params.parent_id = parentId;
      }

      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/catalog/categories`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          params
        }
      );

      this.logger.log(`Categorias obtidas da Yampi: ${response.data.data.length}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter categorias da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCategoryById(categoryId: string, accessToken: string, merchantAlias: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/catalog/categories/${categoryId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria obtida da Yampi: ${categoryId}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter categoria da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createCategory(category: any): Promise<any> {
    try {
      const { token, merchantAlias, ...categoryData } = category;
      
      const response = await axios.post(
        `${this.apiUrl}/${merchantAlias}/catalog/categories`,
        categoryData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria criada na Yampi: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar categoria na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateCategory(categoryId: string, category: any): Promise<any> {
    try {
      const { token, merchantAlias, ...categoryData } = category;
      
      const response = await axios.put(
        `${this.apiUrl}/${merchantAlias}/catalog/categories/${categoryId}`,
        categoryData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria atualizada na Yampi: ${categoryId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar categoria na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteCategory(categoryId: string, accessToken: string, merchantAlias: string): Promise<any> {
    try {
      const response = await axios.delete(
        `${this.apiUrl}/${merchantAlias}/catalog/categories/${categoryId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Categoria deletada na Yampi: ${categoryId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao deletar categoria na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getCategoryAttributes(categoryId: string, accessToken: string, merchantAlias: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/catalog/categories/${categoryId}/attributes`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Atributos da categoria obtidos da Yampi: ${categoryId}`);
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Erro ao obter atributos da categoria da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }
} 