import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OLXCatalogService {
  private readonly logger = new Logger(OLXCatalogService.name);
  private readonly baseUrl = 'https://apps.olx.com.br';
  private readonly name = 'OLX';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Consultar marcas de carros
   * @param accessToken - Token de acesso OAuth
   */
  async getCarBrands(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Consultando marcas de carros no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/car-brands`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Marcas de carros consultadas com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        brands: response.data.brands
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar marcas de carros no ${this.name}:`, error);
      throw new Error(`Falha ao consultar marcas de carros no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar modelos de carros por marca
   * @param accessToken - Token de acesso OAuth
   * @param brandId - ID da marca
   */
  async getCarModels(accessToken: string, brandId: string): Promise<any> {
    try {
      this.logger.log(`Consultando modelos de carros da marca ${brandId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/car-brands/${brandId}/models`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Modelos de carros consultados com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        brandId: brandId,
        models: response.data.models
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar modelos de carros no ${this.name}:`, error);
      throw new Error(`Falha ao consultar modelos de carros no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar marcas de motos
   * @param accessToken - Token de acesso OAuth
   */
  async getMotorcycleBrands(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Consultando marcas de motos no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/motorcycle-brands`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Marcas de motos consultadas com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        brands: response.data.brands
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar marcas de motos no ${this.name}:`, error);
      throw new Error(`Falha ao consultar marcas de motos no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar modelos de motos por marca
   * @param accessToken - Token de acesso OAuth
   * @param brandId - ID da marca
   */
  async getMotorcycleModels(accessToken: string, brandId: string): Promise<any> {
    try {
      this.logger.log(`Consultando modelos de motos da marca ${brandId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/motorcycle-brands/${brandId}/models`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Modelos de motos consultados com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        brandId: brandId,
        models: response.data.models
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar modelos de motos no ${this.name}:`, error);
      throw new Error(`Falha ao consultar modelos de motos no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar categorias
   * @param accessToken - Token de acesso OAuth
   */
  async getCategories(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Consultando categorias no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/categories`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Categorias consultadas com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        categories: response.data.categories
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar categorias no ${this.name}:`, error);
      throw new Error(`Falha ao consultar categorias no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar subcategorias
   * @param accessToken - Token de acesso OAuth
   * @param categoryId - ID da categoria
   */
  async getSubcategories(accessToken: string, categoryId: string): Promise<any> {
    try {
      this.logger.log(`Consultando subcategorias da categoria ${categoryId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/catalog/categories/${categoryId}/subcategories`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Subcategorias consultadas com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        categoryId: categoryId,
        subcategories: response.data.subcategories
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar subcategorias no ${this.name}:`, error);
      throw new Error(`Falha ao consultar subcategorias no ${this.name}: ${error.message}`);
    }
  }
} 