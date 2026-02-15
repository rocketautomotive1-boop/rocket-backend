import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { CategoryAttribute, CategoryDetails } from '../interfaces/category-attribute.interface';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';

@Injectable()
export class MercadoLivreAttributesService {
  private readonly logger = new Logger(MercadoLivreAttributesService.name);
  private readonly baseUrl = 'https://api.mercadolibre.com';

  constructor(
    @InjectModel(MarketplaceModel.name)
    private marketplaceModel: Model<MarketplaceDocument>,
  ) { }

  async getCategoryAttributes(categoryId: string, marketplaceId: string): Promise<CategoryAttribute[]> {
    try {
      // Validate category ID format
      if (!categoryId || !categoryId.startsWith('MLB')) {
        throw new Error('ID da categoria inválido. Deve começar com MLB');
      }

      // Get valid access token
      const accessToken = '';

      // Construir URL correta
      const url = `${this.baseUrl}/categories/${categoryId}/attributes`;
      this.logger.log(`URL da requisição: ${url}`);

      // Fazer a requisição sem autenticação primeiro para testar
      try {
        const publicResponse = await axios.get(url);
        this.logger.log('Resposta da API pública:', publicResponse.data);
      } catch (publicError) {
        this.logger.error('Erro na requisição pública:', publicError.message);
      }

      // Fazer a requisição autenticada
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.data || !Array.isArray(response.data)) {
        this.logger.warn(`Resposta inválida da API do Mercado Livre para categoria ${categoryId}:`, response.data);
        throw new Error('Resposta inválida da API do Mercado Livre');
      }

      this.logger.log(`Atributos encontrados para categoria ${categoryId}: ${response.data.length}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao buscar atributos da categoria ${categoryId}:`, {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
        request: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers
        }
      });

      // Tentar buscar os detalhes da categoria para verificar se ela existe
      try {
        const categoryDetails = await this.getCategoryDetails(categoryId, marketplaceId);
        this.logger.log('Detalhes da categoria:', categoryDetails);
      } catch (detailsError) {
        this.logger.error('Erro ao buscar detalhes da categoria:', detailsError.message);
      }

      if (error.response?.status === 404) {
        this.logger.warn(`Categoria ${categoryId} não encontrada ou não possui atributos no Mercado Livre`);
        return [];
      }

      throw error;
    }
  }

  async getCategoryDetails(categoryId: string, marketplaceId: string): Promise<CategoryDetails> {
    try {
      // Validate category ID format
      if (!categoryId || !categoryId.startsWith('MLB')) {
        throw new Error('ID da categoria inválido. Deve começar com MLB');
      }

      // Get valid access token
      const accessToken = '';

      const response = await axios.get(
        `${this.baseUrl}/categories/${categoryId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.data) {
        throw new Error('Resposta inválida da API do Mercado Livre');
      }

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new NotFoundException(`Categoria ${categoryId} não encontrada no Mercado Livre`);
      }
      this.logger.error(`Erro ao buscar detalhes da categoria ${categoryId} no Mercado Livre:`, error);
      throw error;
    }
  }

  async saveCategoriesAttributes(marketplaceId: string, attributes: CategoryAttribute[]) {
    try {
      const marketplace = await this.marketplaceModel.findById(marketplaceId).exec();
    } catch (error) {
      this.logger.error(`Erro ao salvar atributos das categorias do Mercado Livre:`, error);
      throw error;
    }
  }
}